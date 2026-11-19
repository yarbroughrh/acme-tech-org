"""Router, validation and pagination units."""

from decimal import Decimal

import pytest

from beacon.errors import NotFound, ValidationError
from beacon.http import Router, page_params
from beacon.validation import Fields

ID = "7b0d9c1e-2f3a-4b5c-8d6e-9f0a1b2c3d4e"


@pytest.fixture
def router():
    r = Router("projects")
    r.route("GET", "/lookups")(lambda req, conn: (200, {}))
    r.route("GET", "/{id}")(lambda req, conn: (200, {}))
    r.route("GET", "/{id}/milestones")(lambda req, conn: (200, {}))
    return r


@pytest.mark.parametrize("raw, expected", [
    ("/api/projects", "/"),                                   # cloud root
    ("/api/projects/", "/"),
    (f"/api/projects/{ID}/milestones", f"/{ID}/milestones"),  # cloud nested
    (f"/{ID}/milestones", f"/{ID}/milestones"),               # local (proxy stripped prefix)
    ("/", "/"), ("", "/"),
    ("/api/projectsX/1", "/api/projectsX/1"),                 # CloudFront prefix-match edge: not stripped
])
def test_normalise_path(router, raw, expected):
    assert router.normalise_path(raw) == expected


def test_static_route_wins_and_uuid_params_are_validated(router):
    route, params = router.match("GET", "/lookups")
    assert route.pattern == "/lookups" and params == {}
    route, params = router.match("GET", f"/{ID}/milestones")
    assert params == {"id": ID}
    with pytest.raises(NotFound):
        router.match("GET", "/not-a-uuid")
    with pytest.raises(NotFound):
        router.match("DELETE", f"/{ID}")


def test_fields_collects_all_errors():
    fields = Fields({"name": "  ", "budget": "-5", "start": "2026-13-01", "kind": "X", "flag": "yes", "n": 1.5})
    fields.string("name", required=True)
    fields.decimal("budget", required=True, gt=Decimal(0))
    fields.date("start", required=True)
    fields.choice("kind", ("A", "B"), required=True)
    fields.boolean("flag")
    fields.integer("n")
    fields.email("email", required=True)
    with pytest.raises(ValidationError) as exc:
        fields.raise_if_errors()
    assert {d["field"] for d in exc.value.details} == {"name", "budget", "start", "kind", "flag", "n", "email"}


def test_fields_partial_skips_absent_but_validates_present():
    fields = Fields({"display_name": "Ok"}, partial=True)
    assert fields.string("display_name", required=True) == "Ok"
    assert fields.choice("role", ("A",), required=True) is None
    fields.raise_if_errors()


def test_fields_happy_values():
    fields = Fields({"e": "A@B.CO", "d": "2026-11-19", "u": ID, "x": "12.50", "b": False})
    assert fields.email("e") == "a@b.co"
    assert str(fields.date("d")) == "2026-11-19"
    assert fields.uuid("u") == ID
    assert fields.decimal("x", ge=Decimal("0.5"), le=Decimal(60)) == Decimal("12.50")
    assert fields.boolean("b") is False
    fields.raise_if_errors()


def test_page_params_and_errors():
    sorts = {"name": "lower(p.name)"}
    assert page_params({}, sorts, "name") == (20, 0, "lower(p.name) ASC")
    assert page_params({"page": "3", "page_size": "10", "sort": "-name"}, sorts, "name") == (10, 20, "lower(p.name) DESC")
    with pytest.raises(ValidationError) as exc:
        page_params({"page": "0", "page_size": "1000", "sort": "drop table"}, sorts, "name")
    assert {d["field"] for d in exc.value.details} == {"page", "page_size", "sort"}
