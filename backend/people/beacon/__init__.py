"""Beacon shared library.

Canonical source lives in ``backend/_shared/beacon``. ``bin/sync-shared.sh`` copies it into every
service folder (``backend/<service>/beacon``) because the Lambda packager only zips the service
folder. The copies are committed; ``backend/tests/test_shared_sync.py`` fails if any copy drifts.
Never edit a service's copy directly.
"""
