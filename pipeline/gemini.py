"""Gemini video calls. One uploaded file, then clipped windows."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_model_json(text: str) -> dict:
    cleaned = FENCE_RE.sub("", text.strip())
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("Model JSON was not an object")
    return payload


class GeminiVideo:
    def __init__(self, video: Path, model: str | None = None):
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise SystemExit("Set GEMINI_API_KEY before analyzing a video.")
        try:
            from google import genai
            from google.genai import types
        except ImportError as error:
            raise SystemExit(
                "Install pipeline requirements: pip install -r pipeline/requirements.txt"
            ) from error
        self._types = types
        self._client = genai.Client(api_key=key)
        self.model = model or os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash"
        uploaded = self._client.files.upload(file=str(video))
        deadline = time.time() + 600
        while getattr(uploaded, "state", None) == types.FileState.PROCESSING:
            if time.time() > deadline:
                raise SystemExit("Gemini did not finish processing the video.")
            time.sleep(2)
            uploaded = self._client.files.get(name=uploaded.name)
        if getattr(uploaded, "state", None) == types.FileState.FAILED:
            raise SystemExit("Gemini rejected the video file.")
        self._file = uploaded

    def ask(self, start: float, end: float, fps: float, prompt: str, schema: dict) -> dict:
        types = self._types
        if end <= start:
            return {}
        part = types.Part(
            file_data=types.FileData(
                file_uri=self._file.uri,
                mime_type=self._file.mime_type or "video/mp4",
            ),
            video_metadata=types.VideoMetadata(
                start_offset=f"{start:.3f}s",
                end_offset=f"{end:.3f}s",
                fps=fps,
            ),
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = self._client.models.generate_content(
                    model=self.model,
                    contents=[part, prompt],
                    config=types.GenerateContentConfig(
                        temperature=0,
                        response_mime_type="application/json",
                        response_json_schema=schema,
                    ),
                )
                return parse_model_json(response.text or "{}")
            except (json.JSONDecodeError, ValueError) as error:
                last_error = error
            except Exception as error:  # network and quota errors are raised by the SDK
                last_error = error
                time.sleep(2 * (attempt + 1))
        raise SystemExit(f"Gemini call failed: {last_error}")

    def close(self) -> None:
        name = getattr(self._file, "name", None)
        if name:
            self._client.files.delete(name=name)
