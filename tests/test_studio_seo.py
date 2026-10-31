"""Discoverability changes must preserve the studio's existing controls."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Tags(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class StudioSeoTests(unittest.TestCase):
    def test_studio_has_static_metadata_heading_and_bilingual_guide_links(self):
        text = (ROOT / 'index.html').read_text()
        tags = Tags(text).tags
        meta = {a.get('name', a.get('property')): a.get('content') for t, a in tags if t == 'meta'}
        self.assertIn('description', meta)
        self.assertGreater(len(meta['description']), 60)
        self.assertIn('og:title', meta)
        self.assertIn('og:description', meta)
        self.assertIn('og:url', meta)
        self.assertEqual([a['href'] for t, a in tags if t == 'link' and a.get('rel') == 'canonical'], ['https://xololingua.fr/'])
        self.assertEqual(sum(t == 'h1' for t, _ in tags), 1)
        links = {a.get('href') for t, a in tags if t == 'a'}
        for path in ['/generateur-sous-titres-video', '/traduire-sous-titres-srt', '/sous-titres-youtube',
                     '/en/video-subtitle-generator', '/en/translate-srt-subtitles', '/en/youtube-subtitles']:
            self.assertIn(path, links)
        ids = [a['id'] for _, a in tags if 'id' in a]
        self.assertEqual(len(ids), len(set(ids)))
        for control in ['fileInput', 'identifyButton', 'sourceLanguageSelect', 'targetLanguageSelect',
                        'segmentButton', 'generateButton', 'cancelGenerateButton', 'downloadLink']:
            self.assertIn(control, ids)
        self.assertIn(('html', {'lang': 'en'}), tags)

    def test_studio_reserves_illustration_dimensions(self):
        tags = Tags((ROOT / 'index.html').read_text()).tags
        image = next(a for t, a in tags if t == 'img' and a.get('class') == 'parrot-image')
        self.assertEqual((image.get('width'), image.get('height')), ('1122', '1402'))


if __name__ == '__main__':
    unittest.main()
