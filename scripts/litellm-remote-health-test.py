#!/usr/bin/env python3
"""Mocked-HTTP checks for litellm_gateway.remote_health. No LiteLLM install, no network."""
import importlib.util
import io
import json
import socket
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("litellm_gateway", ROOT / "mods/orca-agent-flyout/litellm_gateway.py")
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)
CONFIG = {"host": "https://gateway.test:4000", "apiKey": "sk-test"}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def opener_returning(body):
    opener = mock.Mock()
    opener.open.return_value = FakeResponse(json.dumps(body).encode())
    return opener


class RemoteHealthTest(unittest.TestCase):
    def check(self, opener):
        with mock.patch.object(gateway.urllib.request, "build_opener", return_value=opener):
            return gateway.remote_health(CONFIG)

    def test_successful_gateway_response_lists_sorted_models(self):
        opener = opener_returning({"data": [{"id": "gpt-4o"}, {"id": "claude-sonnet"}]})
        self.assertEqual(self.check(opener), {"healthy": True, "models": ["claude-sonnet", "gpt-4o"]})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://gateway.test:4000/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer sk-test")

    def test_unreachable_or_timeout_reports_connection_error(self):
        opener = mock.Mock()
        opener.open.side_effect = urllib.error.URLError(socket.timeout("timed out"))
        self.assertEqual(self.check(opener), {
            "healthy": False,
            "error": "Could not connect to LiteLLM. Check the host and network.",
        })

    def test_healthy_gateway_with_empty_model_catalog_is_healthy(self):
        self.assertEqual(self.check(opener_returning({"data": []})), {"healthy": True, "models": []})


if __name__ == "__main__":
    unittest.main()
