#!/usr/bin/python

import requests
import copy
import time
import uuid
import os

from random import randint
from multiprocessing import Process

MANAGEMENT = "https://localhost:4000"
USERNAME = "admin@nvidia.com"
PASSWORD = "admin"

reportClient = {
	"client" : {"clientID" : "client1.excelero.com", "client_status" : 1,
	"block_devices" : [
		]
	}
}

def generateFakeReportClient(reportTemplate, generateGUID, clientID):
	if "client" not in reportTemplate:
		raise Exception("Invalid template")

	template = copy.deepcopy(reportTemplate)
	template["client"]["clientID"] = clientID

	return template


def postReportClient(session, report):
	res = session.post("%s/clients/report" % MANAGEMENT, json=report, verify=False)
	return res.status_code == 200


def startReporting(numberOfReports, sleep):
	print "PID: %s - Starting to report" % os.getpid()
	session = requests.session()
	#login
	session.post("{}/login".format(MANAGEMENT), params={"username": USERNAME, "password": PASSWORD}, verify=False)

	#report
	generateGUID = False
	report = None
	for i in range(numberOfReports):
		print "PID: %s - Reporting report %d out of %d" % (os.getpid(), i+1, numberOfReports)
		report = generateFakeReportClient(report or reportClient, generateGUID, "client-%s.excelero.com" % os.getpid())
		report["client"]["clientID"] = "nvme47.excelero.com"
		postReportClient(session, report)
		generateGUID = False

		time.sleep(sleep)

	print "PID: %s - Finish to report" % os.getpid()

if __name__ == '__main__':
	processes = []
	for i in range(1):
		p = Process(target=startReporting, args=(1, 0))
		p.start()
		processes.append(p)
		#time.sleep(0)



