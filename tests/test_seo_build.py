"""Public-build allowlist and SEO discovery contract, without ML dependencies."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ROUTES = (
    'generateur-sous-titres-video', 'traduire-sous-titres-srt', 'sous-titres-youtube',
    'en/video-subtitle-generator', 'en/translate-srt-subtitles', 'en/youtube-subtitles',
)


def load_build():
    spec = importlib.util.spec_from_file_location('build_static', ROOT / 'scripts/build_static.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SeoBuildTests(unittest.TestCase):
    def test_build_publishes_only_allowlisted_guides_and_discovery_files(self):
        module = load_build()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            for name in (*module.FILES, 'robots.txt', 'seo/seo.css', *(f'seo/{r}.html' for r in ROUTES)):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture: ' + name)
            (root / 'sw.js').write_text('const ASSETS = ["."];')
            for name in module.DIRECTORIES:
                path = root / name
                path.mkdir(parents=True, exist_ok=True)
                (path / 'fixture.txt').write_text(name)
            for name in ('.env', 'seo/draft.html', 'seo/.env', 'local_service.py'):
                (root / name).write_text('must not be published')
            output = Path(directory) / 'public'
            with patch.object(module, 'ROOT', root):
                module.build(output)
            for route in ROUTES:
                self.assertTrue((output / f'{route}.html').is_file(), f'missing published guide {route}')
                self.assertEqual((output / f'{route}.html').read_text(), 'fixture: seo/' + route + '.html')
            self.assertTrue((output / 'seo/seo.css').is_file())
            self.assertTrue((output / 'robots.txt').is_file())
            for name in ('.env', 'seo/.env', 'seo/draft.html', 'local_service.py'):
                self.assertFalse((output / name).exists(), name)
            tree = ET.parse(output / 'sitemap.xml')
            ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
            locations = [node.text for node in tree.findall('s:url/s:loc', ns)]
            expected = ['https://xololingua.fr/'] + ['https://xololingua.fr/' + route for route in ROUTES]
            self.assertEqual(locations, expected)
            self.assertEqual(tree.findall('.//s:lastmod', ns), [])

    def test_missing_guide_is_rejected_before_creating_output(self):
        module = load_build()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            for name in (*module.FILES, 'robots.txt', 'seo/seo.css', *(f'seo/{r}.html' for r in ROUTES)):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture')
            for name in module.DIRECTORIES:
                (root / name).mkdir(parents=True, exist_ok=True)
            (root / 'sw.js').write_text('const ASSETS = ["."];')
            (root / 'seo/en/youtube-subtitles.html').unlink()
            output = Path(directory) / 'public'
            with patch.object(module, 'ROOT', root):
                with self.assertRaisesRegex(FileNotFoundError, 'youtube-subtitles'):
                    module.build(output)
            self.assertFalse(output.exists())

    def test_existing_output_is_never_overwritten(self):
        module = load_build()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                module.build(Path(directory))

    def test_robots_announces_sitemap_without_blocking_web_assets(self):
        self.assertTrue((ROOT / 'robots.txt').is_file(), 'missing public robots.txt')
        text = (ROOT / 'robots.txt').read_text()
        self.assertIn('User-agent: *', text)
        self.assertIn('Disallow: /api/', text)
        self.assertIn('Sitemap: https://xololingua.fr/sitemap.xml', text)
        self.assertNotIn('Disallow: /\n', text)
        self.assertNotIn('Disallow: /assets', text)


if __name__ == '__main__':
    unittest.main()
