"""Verify the revised match controls against one built bundle with owned server cleanup."""
from verify_environment_release import ROOT,run

if __name__=='__main__':
 run(['controls','camera','browser','menu','showcase'],ROOT/'validation/controls-production-report.json','controls')
