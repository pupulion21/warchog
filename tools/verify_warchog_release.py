"""Check contract-driven lobby, unchanged game controls, menu and shared 3D renderer."""
from verify_environment_release import ROOT,run
if __name__=='__main__':
 run(['duel','controls','menu','showcase'],ROOT/'validation/warchog-production-report.json','warchog')
