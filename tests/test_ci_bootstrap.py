"""CI's PDM tool dependencies are independent of the application lockfile."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CiBootstrapTests(unittest.TestCase):
    def test_pdm_install_uses_the_reviewed_tool_constraint(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('pip install --upgrade pip "pdm==$PDM_VERSION" -c .github/pdm-constraints.txt', workflow)
        constraints = ROOT / '.github/pdm-constraints.txt'
        self.assertTrue(constraints.is_file())
        requirements = [line.strip() for line in constraints.read_text().splitlines()
                        if line.strip() and not line.lstrip().startswith('#')]
        self.assertEqual(requirements, ['unearth==0.18.2'])

    def test_ci_exercises_pdm_http_session_before_project_install(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('PDMPyPIClient(sources=[]).close()', workflow)
        self.assertLess(workflow.index('PDMPyPIClient(sources=[]).close()'),
                        workflow.index('pdm install -G test --frozen-lockfile'))


if __name__ == '__main__':
    unittest.main()
