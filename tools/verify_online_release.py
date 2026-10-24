"""Finite production acceptance; its database and server never share user state."""
import os
from verify_environment_release import ROOT,run
if __name__=='__main__':
 os.environ['WARCHOG_ROUND_SECONDS']='90'
 run(['online','standalone','duel','controls','menu','showcase'],ROOT/'validation/online-production-report.json','online')
