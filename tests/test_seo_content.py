"""Static editorial contracts; stdlib only, no browser or model downloads."""
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAIRS = (
    ('generateur-sous-titres-video', 'en/video-subtitle-generator'),
    ('traduire-sous-titres-srt', 'en/translate-srt-subtitles'),
    ('sous-titres-youtube', 'en/youtube-subtitles'),
)
ORIGIN = 'https://xololingua.fr'


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.text = []
        self.captures = {}
        self.active = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.elements.append((tag, attrs))
        if tag in ('title', 'h1', 'h2', 'script', 'main', 'aside', 'pre'):
            entry = {'tag': tag, 'attrs': attrs, 'text': ''}
            self.captures.setdefault(tag, []).append(entry)
            self.active.append(entry)

    def handle_endtag(self, tag):
        self.active = [entry for entry in self.active if entry['tag'] != tag]

    def handle_data(self, data):
        if not any(entry['tag'] == 'script' for entry in self.active):
            self.text.append(data)
        for entry in self.active:
            entry['text'] += data

    def attrs(self, tag, **criteria):
        return [attrs for name, attrs in self.elements if name == tag
                and all(attrs.get(key) == value for key, value in criteria.items())]


def load(route):
    path = ROOT / 'seo' / (route + '.html')
    return Document(path.read_text(encoding='utf-8'))


class SeoContentTests(unittest.TestCase):
    def test_static_bilingual_identity_and_navigation(self):
        titles, descriptions, headings = [], [], []
        for pair in PAIRS:
            for lang, route in zip(('fr', 'en'), pair):
                with self.subTest(route=route):
                    path = ROOT / 'seo' / (route + '.html')
                    self.assertTrue(path.is_file(), f'Missing static guide: {path}')
                    doc = load(route)
                    url = ORIGIN + '/' + route
                    self.assertEqual(doc.attrs('html')[0]['lang'], lang)
                    title = doc.captures['title'][0]['text']
                    description = doc.attrs('meta', name='description')[0]['content']
                    h1 = doc.captures['h1']
                    self.assertEqual(len(h1), 1)
                    self.assertTrue(title.strip())
                    self.assertTrue(description.strip())
                    self.assertTrue(h1[0]['text'].strip())
                    titles.append(title)
                    descriptions.append(description)
                    headings.append(h1[0]['text'])
                    self.assertEqual(doc.attrs('link', rel='canonical'), [{'rel': 'canonical', 'href': url}])
                    self.assertEqual({a['hreflang']: a['href'] for a in doc.attrs('link', rel='alternate')},
                                     {'fr': ORIGIN + '/' + pair[0], 'en': ORIGIN + '/' + pair[1]})
                    for prop, expected in [('og:title', title), ('og:description', description),
                                           ('og:url', url), ('og:type', 'website')]:
                        self.assertEqual(doc.attrs('meta', property=prop)[0]['content'], expected)
                    self.assertEqual(doc.attrs('link', rel='stylesheet')[0]['href'], '/seo/seo.css')
                    self.assertEqual(doc.attrs('link', rel='icon')[0]['href'], '/assets/icon.svg')
                    links = doc.attrs('a')
                    hrefs = {a['href'] for a in links}
                    self.assertIn('/', hrefs)
                    self.assertTrue(any(a.get('hreflang') == ('en' if lang == 'fr' else 'fr')
                                        and a['href'] == '/' + pair[1 if lang == 'fr' else 0] for a in links))
                    for sibling in PAIRS:
                        self.assertIn('/' + sibling[0 if lang == 'fr' else 1], hrefs)
                    self.assertTrue(doc.attrs('main', id='main'))
                    self.assertIn('#main', hrefs)
                    for tag in ('iframe', 'video', 'audio', 'input', 'form'):
                        self.assertFalse(doc.attrs(tag), f'Unexpected interactive/heavy asset: {tag}')
                    self.assertFalse(doc.attrs('link', rel='preload'))
                    for script in doc.attrs('script'):
                        self.assertEqual(script.get('type'), 'application/ld+json')
                        self.assertNotIn('src', script)
                    for a in links:
                        self.assertFalse(a['href'].endswith('.html'))
                        self.assertNotIn('?', a['href'].split('xololingua.fr')[-1] if 'xololingua.fr' in a['href'] else a['href'] if a['href'].startswith('/') else '')
        self.assertEqual(len(set(titles)), 6)
        self.assertEqual(len(set(descriptions)), 6)
        self.assertEqual(len(set(headings)), 6)

    def test_guides_offer_substantive_truthful_tutorials(self):
        for index, pair in enumerate(PAIRS):
            for lang, route in zip(('fr', 'en'), pair):
                with self.subTest(route=route):
                    doc = load(route)
                    text = ' '.join(doc.captures['main'][0]['text'].split())
                    words = re.findall(r"\b[\w’'-]+\b", text)
                    self.assertGreaterEqual(len(words), 450, 'A useful tutorial, not a landing-page stub')
                    self.assertLessEqual(len(words), 800, 'Keep each guide focused')
                    self.assertGreaterEqual(len(doc.captures['h2']), 4)
                    self.assertTrue(doc.attrs('ol'), 'Include a native step-by-step tutorial')
                    self.assertIn('MP4', text)
                    self.assertIn('SRT', text)
                    self.assertIn('400 MiB', text)
                    self.assertRegex(text, r'1 (?:heure|hour)')
                    required = {
                        'fr': [r'cible doit être différente', r'pas d.export monolingue',
                               r'import.*SRT.*(?:pas|non)', r'pas d.éditeur',
                               r'modèles.*(?:distants|téléchargés)', r'(?:média|vidéo|audio).*local',
                               r'(?:pas|sans).*hors ligne', r'compatibilité', r'relecture',
                               r'pas toutes les langues', r'(?:pas|ni).*URL YouTube',
                               r'(?:pas|ni).*publication automatique'],
                        'en': [r'target language must be different', r'no monolingual export',
                               r'(?:SRT import.*not|not.*SRT import)', r'no built-in editor',
                               r'models.*(?:remote|download)', r'(?:media|video|audio).*local',
                               r'(?:not|no).*offline', r'compatibility', r'proofread',
                               r'not all languages', r'(?:no|not).*YouTube URL',
                               r'(?:no|not).*automatic publishing'],
                    }
                    for pattern in required[lang]:
                        self.assertRegex(text, re.compile(pattern, re.I), f'Missing truthful limit: {pattern}')
                    scripts = doc.captures.get('script', [])
                    self.assertEqual(len(scripts), 1)
                    graph = json.loads(scripts[0]['text'])['@graph']
                    self.assertEqual({item['@type'] for item in graph}, {'WebPage', 'BreadcrumbList'})
                    webpage = next(item for item in graph if item['@type'] == 'WebPage')
                    self.assertEqual(webpage['url'], ORIGIN + '/' + route)
                    self.assertEqual(webpage['inLanguage'], lang)
                    self.assertEqual(webpage['name'], doc.captures['title'][0]['text'])
                    self.assertNotIn('aggregateRating', scripts[0]['text'])
                    if index == 1:
                        self.assertIn('illustr', text.lower())
                        self.assertTrue(doc.captures.get('pre'), 'SRT format example is visible without JS')
                        self.assertIn('00:00:01,000 --> 00:00:03,000', doc.captures['pre'][0]['text'])
                        warnings = doc.attrs('section', **{'class': 'seo-notice'})
                        self.assertTrue(warnings, 'Prominent SRT import warning required')
                        self.assertLess(text.lower().find('srt'), 250)
                        self.assertRegex(text.lower(), r'(?:original|origine).*mp4|mp4.*(?:original|origine)')
                    if index == 2:
                        self.assertIn('YouTube Studio', text)
                        self.assertRegex(text.lower(), r'manu(?:al|el)')
                        self.assertIn(f'https://support.google.com/youtube/answer/2734796?hl={lang}',
                                      {a['href'] for a in doc.attrs('a')})

    def test_styles_are_scoped_responsive_and_keyboard_accessible(self):
        path = ROOT / 'seo' / 'seo.css'
        self.assertTrue(path.is_file(), 'Guide stylesheet must exist')
        css = path.read_text(encoding='utf-8')
        self.assertNotIn('@import', css)
        self.assertNotIn('url(', css)
        self.assertIn(':focus-visible', css)
        self.assertIn('.seo-skip:focus', css)
        self.assertIn('@media', css)
        self.assertIn('minmax(0, 1fr)', css)
        self.assertIn('overflow-wrap', css)
        self.assertIn('44px', css)
        # Every ordinary rule starts in the guide namespace, never global body/h1.
        clean = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
        for match in re.finditer(r'([^{}]+)\{', clean):
            selector = match.group(1).strip()
            if selector.startswith('@'):
                continue
            for item in selector.split(','):
                self.assertTrue(item.strip().startswith('.seo-page'), f'Unscoped rule: {item}')
        colors = dict(re.findall(r'(--seo-[\w-]+):\s*(#[0-9a-fA-F]{6})', css))
        def luminance(value):
            rgb = [int(value[n:n + 2], 16) / 255 for n in (1, 3, 5)]
            linear = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
            return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722)))
        for foreground, background in [('--seo-ink', '--seo-panel'), ('--seo-muted', '--seo-panel'),
                                        ('--seo-accent', '--seo-panel'), ('--seo-panel', '--seo-accent')]:
            values = sorted((luminance(colors[foreground]), luminance(colors[background])))
            self.assertGreaterEqual((values[1] + 0.05) / (values[0] + 0.05), 4.5)


if __name__ == '__main__':
    unittest.main()
