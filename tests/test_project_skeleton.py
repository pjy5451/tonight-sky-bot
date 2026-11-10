from tonight_sky_bot import __version__
from tonight_sky_bot.app import main


def test_package_has_version() -> None:
    assert __version__ == "0.1.0"


def test_app_entrypoint_succeeds() -> None:
    assert main() == 0
