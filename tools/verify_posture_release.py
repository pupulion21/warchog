"""Verify upright ready poses, action clips and roster swaps on the current production build."""
from verify_environment_release import ROOT,run

if __name__=='__main__':
 run(['posture','roster'],ROOT/'validation/posture-production-report.json','posture',{'roster':'roster-browser-report.json'})
