"""Unit tests for translation helpers (no ffmpeg required)."""

import unittest
from unittest import mock

import local_service
from xololingua_service import translation


class GetSupportedPairsTests(unittest.TestCase):
    def test_get_supported_pairs_returns_empty_when_argos_unavailable(self):
        with mock.patch.object(translation, "_argos_translate", None):
            result = translation.get_supported_pairs()
        self.assertEqual(result, [])

    def test_get_supported_pairs_excludes_identity_pairs(self):
        fake_lang = mock.MagicMock()
        fake_lang.code = "fr"

        same = mock.MagicMock()
        same.from_lang.code = "fr"
        same.to_lang.code = "fr"

        other = mock.MagicMock()
        other.from_lang.code = "fr"
        other.to_lang.code = "en"

        fake_lang.translations_from = [same, other]

        with mock.patch.object(translation, "_argos_translate") as argos_mock:
            argos_mock.get_installed_languages.return_value = [fake_lang]
            result = translation.get_supported_pairs()

        self.assertEqual(result, [{"source": "fr", "target": "en"}])

    def test_get_supported_pairs_returns_all_pairs(self):
        def make_lang(code, targets):
            lang = mock.MagicMock()
            lang.code = code
            translations = []
            for t in targets:
                tr = mock.MagicMock()
                tr.from_lang.code = code
                tr.to_lang.code = t
                translations.append(tr)
            lang.translations_from = translations
            return lang

        langs = [
            make_lang("en", ["fr", "de"]),
            make_lang("fr", ["en"]),
        ]

        with mock.patch.object(translation, "_argos_translate") as argos_mock:
            argos_mock.get_installed_languages.return_value = langs
            result = translation.get_supported_pairs()

        self.assertCountEqual(result, [
            {"source": "en", "target": "fr"},
            {"source": "en", "target": "de"},
            {"source": "fr", "target": "en"},
            {"source": "fr", "target": "de"},
        ])

    def test_get_supported_pairs_includes_english_pivot_pairs(self):
        def make_lang(code, targets):
            lang = mock.MagicMock()
            lang.code = code
            lang.translations_from = []
            for target in targets:
                tr = mock.MagicMock()
                tr.from_lang.code = code
                tr.to_lang.code = target
                lang.translations_from.append(tr)
            return lang

        langs = [
            make_lang("fr", ["en"]),
            make_lang("en", ["ru", "uk"]),
        ]

        with mock.patch.object(translation, "_argos_translate") as argos_mock:
            argos_mock.get_installed_languages.return_value = langs
            result = translation.get_supported_pairs()

        self.assertCountEqual(result, [
            {"source": "fr", "target": "en"},
            {"source": "en", "target": "ru"},
            {"source": "en", "target": "uk"},
            {"source": "fr", "target": "ru"},
            {"source": "fr", "target": "uk"},
        ])

    def test_argos_python_translator_can_translate_through_english_pivot(self):
        fr = mock.MagicMock(code="fr")
        en = mock.MagicMock(code="en")
        ru = mock.MagicMock(code="ru")

        fr_en = mock.MagicMock()
        fr_en.translate.return_value = "Hello."
        en_ru = mock.MagicMock()
        en_ru.translate.return_value = "Привет."

        fr.get_translation.side_effect = lambda target: fr_en if target.code == "en" else None
        en.get_translation.side_effect = lambda target: en_ru if target.code == "ru" else None
        ru.get_translation.return_value = None

        with mock.patch.object(translation, "_argos_translate") as argos_mock:
            argos_mock.get_installed_languages.return_value = [fr, en, ru]
            translator = translation._build_argos_python_translator("fr", "ru")

        if translator is None:
            self.fail("Expected an English-pivot translator.")
        self.assertEqual(translator("Bonjour.", "fr", "ru"), "Привет.")
        fr_en.translate.assert_called_once_with("Bonjour.")
        en_ru.translate.assert_called_once_with("Hello.")


class TranslateSegmentsTests(unittest.TestCase):
    def test_translate_segments_adds_translated_text(self):
        segments = [{"index": 1, "start": 0.0, "end": 2.0, "text": "Bonjour."}]

        with mock.patch.object(translation, "translate_texts", return_value=["Hello."]):
            result = local_service.translate_segments(segments, "fr", "en")

        self.assertEqual(result, [{
            "index": 1,
            "start": 0.0,
            "end": 2.0,
            "text": "Bonjour.",
            "translatedText": "Hello.",
        }])

    def test_translate_segments_preserves_order_with_workers(self):
        segments = [
            {"index": 1, "start": 0.0, "end": 1.0, "text": "Un."},
            {"index": 2, "start": 1.0, "end": 2.0, "text": "Deux."},
        ]

        def fake_translate(texts, _source, _target, _job_id=None):
            return [{"Un.": "One.", "Deux.": "Two."}[text] for text in texts]

        with mock.patch.object(translation, "translate_texts", side_effect=fake_translate):
            result = local_service.translate_segments(segments, "fr", "en", max_workers=2)

        self.assertEqual([segment["translatedText"] for segment in result], ["One.", "Two."])


if __name__ == "__main__":
    unittest.main()
