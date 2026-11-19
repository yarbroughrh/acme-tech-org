"""Field validation that collects every problem and reports them together (400 + details)."""

import re
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from beacon.errors import ValidationError, field_error

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MISSING = object()


class Fields:
    """Validate fields of a JSON object; call ``raise_if_errors()`` once at the end."""

    def __init__(self, data: dict[str, Any], partial: bool = False):
        self.data = data
        self.partial = partial  # for updates: absent fields are skipped, not required
        self.errors: list[dict[str, str]] = []
        self.present: set[str] = set()

    def _get(self, name: str, required: bool) -> Any:
        value = self.data.get(name, _MISSING)
        if value is _MISSING or value is None or (isinstance(value, str) and not value.strip()):
            if required and not (self.partial and value is _MISSING):
                self.errors.append(field_error(name, f"{_label(name)} is required."))
            elif value is not _MISSING:
                self.present.add(name)
            return _MISSING
        self.present.add(name)
        return value

    def string(self, name: str, required: bool = False, min_len: int = 1, max_len: int = 255) -> str | None:
        """A trimmed string within length bounds."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        if not isinstance(value, str):
            self.errors.append(field_error(name, f"{_label(name)} must be text."))
            return None
        value = value.strip()
        if not min_len <= len(value) <= max_len:
            self.errors.append(field_error(name, f"{_label(name)} must be {min_len}–{max_len} characters."))
            return None
        return value

    def email(self, name: str, required: bool = False) -> str | None:
        """A syntactically valid email address, lower-cased."""
        value = self.string(name, required, 3, 254)
        if value is not None and not _EMAIL_RE.match(value):
            self.errors.append(field_error(name, f"{_label(name)} must be a valid email address."))
            return None
        return value.lower() if value else None

    def choice(self, name: str, choices: Iterable[str], required: bool = False) -> str | None:
        """One of an allowed set of codes."""
        allowed = tuple(choices)
        value = self._get(name, required)
        if value is _MISSING:
            return None
        if value not in allowed:
            self.errors.append(field_error(name, f"{_label(name)} must be one of: {', '.join(allowed)}."))
            return None
        return value

    def boolean(self, name: str, required: bool = False) -> bool | None:
        """A JSON boolean."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        if not isinstance(value, bool):
            self.errors.append(field_error(name, f"{_label(name)} must be true or false."))
            return None
        return value

    def integer(self, name: str, required: bool = False, min_value: int | None = None,
                max_value: int | None = None) -> int | None:
        """A whole number within optional bounds."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            self.errors.append(field_error(name, f"{_label(name)} must be a whole number."))
            return None
        if (min_value is not None and value < min_value) or (max_value is not None and value > max_value):
            self.errors.append(field_error(name, f"{_label(name)} must be between {min_value} and {max_value}."))
            return None
        return value

    def decimal(self, name: str, required: bool = False, gt: Decimal | None = None,
                ge: Decimal | None = None, le: Decimal | None = None) -> Decimal | None:
        """A number (JSON number or numeric string) within optional bounds."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        try:
            if isinstance(value, bool):
                raise InvalidOperation
            number = Decimal(str(value))
            if not number.is_finite():
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            self.errors.append(field_error(name, f"{_label(name)} must be a number."))
            return None
        if gt is not None and not number > gt:
            self.errors.append(field_error(name, f"{_label(name)} must be greater than {gt}."))
            return None
        if ge is not None and not number >= ge:
            self.errors.append(field_error(name, f"{_label(name)} must be at least {ge}."))
            return None
        if le is not None and not number <= le:
            self.errors.append(field_error(name, f"{_label(name)} must be at most {le}."))
            return None
        return number

    def date(self, name: str, required: bool = False) -> date | None:
        """An ISO date ``YYYY-MM-DD``."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        try:
            if not isinstance(value, str) or len(value) != 10:
                raise ValueError
            return date.fromisoformat(value)
        except ValueError:
            self.errors.append(field_error(name, f"{_label(name)} must be a date (YYYY-MM-DD)."))
            return None

    def uuid(self, name: str, required: bool = False) -> str | None:
        """A UUID reference (existence is checked by the service)."""
        value = self._get(name, required)
        if value is _MISSING:
            return None
        try:
            return str(uuid.UUID(str(value)))
        except ValueError:
            self.errors.append(field_error(name, f"{_label(name)} is not a valid reference."))
            return None

    def add_error(self, name: str, message: str) -> None:
        """Record a cross-field or reference error."""
        self.errors.append(field_error(name, message))

    def raise_if_errors(self, message: str = "Please correct the highlighted fields.") -> None:
        """Raise a 400 with all collected details."""
        if self.errors:
            raise ValidationError(message, self.errors)


def _label(name: str) -> str:
    return name.replace("_", " ").capitalize()
