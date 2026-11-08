"""Address lookup. Production uses the U.S. Census Geocoder (no key, server-side only:
it does not allow browser calls). Results are cached by the store, so each distinct
address is looked up once, and saved displays are never looked up again on load."""

import json
import re
import urllib.parse
import urllib.request

CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
USER_AGENT = 'MonroeStreetTattler-SantaMap/1.0 (+https://monroestreettattler.com/santa-map.html)'


class GeocoderUnavailable(Exception):
    pass


_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def clean_text(value):
    return ' '.join(_CONTROL.sub(' ', value).split())


def query_for(entered):
    """Routine local reports need only a house number and street: add Madison, WI
    unless the visitor already gave a city, state or ZIP code."""
    text = clean_text(entered)
    lower = text.lower()
    if 'madison' in lower or re.search(r'\b\d{5}\b', text) or re.search(r',\s*wi(sconsin)?\b', lower):
        return text
    return text + ', Madison, WI'


def query_key(entered):
    return query_for(entered).lower()


def _match(m):
    return {'address': clean_text(m['matchedAddress']),
            'lat': float(m['coordinates']['y']), 'lon': float(m['coordinates']['x'])}


class CensusGeocoder:
    name = 'census'

    def __init__(self, timeout=8):
        self.timeout = timeout

    def lookup(self, query):
        url = CENSUS_URL + '?' + urllib.parse.urlencode(
            {'address': query, 'benchmark': 'Public_AR_Current', 'format': 'json'})
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read(2_000_000))
            return [_match(m) for m in data['result']['addressMatches']]
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise GeocoderUnavailable(str(e)) from None


class FixtureGeocoder:
    """For tests and local review only: answers from a JSON file of saved Census results,
    keyed by lower-case query. Unknown queries have no match."""
    name = 'fixture'

    def __init__(self, answers=None, path=None):
        if path:
            with open(path, encoding='utf-8') as f:
                answers = json.load(f)
        self.answers = {k.lower(): v for k, v in (answers or {}).items()}
        self.calls = 0
        self.down = False

    def lookup(self, query):
        self.calls += 1
        if self.down:
            raise GeocoderUnavailable('fixture geocoder switched off')
        return [dict(m) for m in self.answers.get(query.lower(), [])]
