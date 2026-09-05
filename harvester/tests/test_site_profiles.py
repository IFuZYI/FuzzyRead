"""Tests for data-driven site-profile selection (parsers.json `match` rules)."""
import sys
import unittest
from pathlib import Path

HARVESTER = Path(__file__).resolve().parents[1]
if str(HARVESTER) not in sys.path:
    sys.path.insert(0, str(HARVESTER))

import config  # noqa: E402
import utils  # noqa: E402


class SiteProfileTests(unittest.TestCase):
    def test_parsers_declare_a_default_profile(self):
        self.assertIn(config.DEFAULT_SITE_PROFILE, config.SITE_PARSER_CONFIGS)

    def test_known_sites_map_to_their_own_profile(self):
        cases = [
            ('bbc_english_top', 'http://feeds.bbci.co.uk/news/rss.xml', 'bbc'),
            ('bbc_chinese_simp', 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', 'bbc'),
            ('time_english_top', 'https://time.com/feed/', 'time'),
        ]
        for feed_key, url, expected in cases:
            with self.subTest(feed_key=feed_key):
                self.assertEqual(utils.detect_site_brand(feed_key, url), expected)

    def test_unknown_feed_falls_back_to_generic(self):
        cases = [
            ('guardian_world', 'https://www.theguardian.com/world/rss'),
            ('nytimes_world', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'),
            ('brand_new_source', 'https://example.invalid/feed.xml'),
        ]
        for feed_key, url in cases:
            with self.subTest(feed_key=feed_key):
                self.assertEqual(utils.detect_site_brand(feed_key, url), config.DEFAULT_SITE_PROFILE)

    def test_every_profile_has_the_required_keys(self):
        for brand, policy in config.SITE_PARSER_CONFIGS.items():
            with self.subTest(brand=brand):
                self.assertIn('core_selectors', policy)
                self.assertIn('bad_sub_selectors', policy)
                self.assertIsInstance(policy.get('match', []), list)
                self.assertTrue(policy['core_selectors'], 'core_selectors must not be empty')

    def test_only_the_default_profile_has_no_match_rules(self):
        for brand, policy in config.SITE_PARSER_CONFIGS.items():
            if brand == config.DEFAULT_SITE_PROFILE:
                continue
            with self.subTest(brand=brand):
                self.assertTrue(policy.get('match'), f'{brand} needs at least one match token')

    def test_global_ledgers_are_loaded(self):
        self.assertTrue(config.HARD_MELTDOWN_TAGS)
        self.assertTrue(config.GHOST_IMAGE_PATTERNS)
        self.assertTrue(config.GLOBAL_URL_BLOCK_KEYWORDS)


if __name__ == '__main__':
    unittest.main()
