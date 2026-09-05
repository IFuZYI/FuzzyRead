"""Tests for the harvester entry points and merged-project path resolution."""
import os
import subprocess
import sys
import unittest
from pathlib import Path

HARVESTER = Path(__file__).resolve().parents[1]
PROJECT_ROOT = HARVESTER.parent
PYTHON = sys.executable


def run_runner(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [PYTHON, str(HARVESTER / 'runner.py'), *args],
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
    )


class RunnerCliTests(unittest.TestCase):
    def test_help_is_available_without_network(self):
        result = run_runner('--help')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--mode', result.stdout)

    def test_rejects_invalid_mode(self):
        result = run_runner('--mode', 'invalid')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid choice', result.stderr)

    def test_mode_is_required(self):
        result = run_runner()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--mode', result.stderr)

    def test_runs_from_project_root_working_directory(self):
        result = run_runner('--help', cwd=PROJECT_ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)


class ConfigPathTests(unittest.TestCase):
    """Config must resolve settings/data from the package, not the CWD."""

    def setUp(self):
        self._cwd = Path.cwd()
        if str(HARVESTER) not in sys.path:
            sys.path.insert(0, str(HARVESTER))

    def tearDown(self):
        os.chdir(self._cwd)

    def _load_config(self):
        for module in ('config',):
            sys.modules.pop(module, None)
        import config
        return config

    def test_settings_resolve_from_any_working_directory(self):
        for cwd in (PROJECT_ROOT, PROJECT_ROOT.parent, HARVESTER):
            with self.subTest(cwd=str(cwd)):
                os.chdir(cwd)
                config = self._load_config()
                self.assertTrue(Path(config.FEEDS_JSON_PATH).is_file())
                self.assertTrue(Path(config.PARSERS_JSON_PATH).is_file())

    def test_feeds_are_loaded(self):
        os.chdir(PROJECT_ROOT)
        config = self._load_config()
        self.assertGreater(len(config.RSS_FEEDS), 0)
        self.assertIn('bbc_english_top', config.RSS_FEEDS)

    def test_data_dirs_point_at_shared_data_folder(self):
        os.chdir(PROJECT_ROOT)
        config = self._load_config()
        expected_articles = PROJECT_ROOT / 'data' / 'articles'
        expected_logs = PROJECT_ROOT / 'data' / 'logs'
        self.assertEqual(Path(config.DOWNLOAD_BASE_DIR).resolve(), expected_articles.resolve())
        self.assertEqual(Path(config.LOG_DIR).resolve(), expected_logs.resolve())

    def test_env_overrides_are_respected(self):
        os.chdir(PROJECT_ROOT)
        override = PROJECT_ROOT / '.hermes' / 'tmp' / 'articles-override'
        os.environ['NEWS_ARTICLES_DIR'] = str(override)
        try:
            config = self._load_config()
            self.assertEqual(Path(config.DOWNLOAD_BASE_DIR), override)
        finally:
            del os.environ['NEWS_ARTICLES_DIR']


class ArticleStoreTests(unittest.TestCase):
    def test_single_article_store_exists_and_has_content(self):
        articles = PROJECT_ROOT / 'data' / 'articles'
        self.assertTrue(articles.is_dir())
        markdown = list(articles.rglob('*.md'))
        self.assertGreater(len(markdown), 0)

    def test_old_split_layout_is_gone(self):
        self.assertFalse((PROJECT_ROOT / 'NEWS').exists())
        self.assertFalse((PROJECT_ROOT / 'WEBSITE').exists())

    def test_no_duplicate_article_ids(self):
        articles = PROJECT_ROOT / 'data' / 'articles'
        seen: dict[str, Path] = {}
        duplicates = []
        for md in articles.rglob('*.md'):
            if md.stem in seen:
                duplicates.append((md.stem, seen[md.stem], md))
            seen[md.stem] = md
        self.assertEqual(duplicates, [], f'duplicate article ids: {duplicates}')


if __name__ == '__main__':
    unittest.main()
