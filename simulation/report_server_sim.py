#!/usr/bin/python

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

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

reportServer = {
	"node" : {"node_id" : "test1.acme.com", "node_status" : 1,
	"nics" : [
			{"nicID": "0xfe80000000000000e41d2d03001f9272", "protocol" : 1, "status" : 1, "guid" : "0xfe80000000000000001e670300932492", "pkey" : "ffff", "speed" : 1, "pci_root" : 1},
			{"nicID": "0xfe80000000000000e41d2d03001f9271", "protocol" : 2, "status" : 1, "guid" : "0xfe80000000000000001e670300932491", "pkey" : "ffff", "speed" : 1, "pci_root" : 1}
	],
	"disks" : [
		{"diskID": "CVCQ5222000C400AGN.2", "protocol" : 1, "blocks" : 781422768, "block_size" : 512, "max_dma_blocks" : 256, "status" : 1, "pci_root" : 2 , "Serial_Number" : "CVMD4381005Q402AGN", "Vendor" : "0x8086", "Model" : "INTEL_SSDPEDME400G4_____________________", "Submission_Queues" : "31", "Completion_Queues" : "31", "MSIX_Interrupts" : "32", "Numa_Node" : "-1", "Critical_Warning" : "0x0", "Temperature" : "307_K", "Available_Spare" : "100_%", "Available_Spare_Threshold" : "10_%", "Percentage_Used" : "0_%", "Data_Units_Read" : "0x2de0ffef0", "Data_Units_Written" : "0xc29ddb28", "Host_Read_Commands" : "0x4046dcfd", "Host_Write_Commands" : "0x26ea520", "Controller_Busy_Time" : "0x8", "Power_Cycles" : "0x97", "Power_On_Hours" : "0x12ce", "Unsafe_Shutdowns" : "0x82", "Media_Errors" : "0x0", "Number_of_Error_Information_Log_Entries" : "0x0"},
		{"diskID": "CVCQ5222000B400AGN.2", "protocol" : 1, "blocks" : 781422768, "block_size" : 512, "max_dma_blocks" : 256, "status" : 1, "pci_root" : 1 , "Serial_Number" : "CVMD438000BL402AGN", "Vendor" : "0x8086", "Model" : "INTEL_SSDPEDME400G4_____________________", "Submission_Queues" : "31", "Completion_Queues" : "31", "MSIX_Interrupts" : "32", "Numa_Node" : "-1", "Critical_Warning" : "0x0", "Temperature" : "306_K", "Available_Spare" : "100_%", "Available_Spare_Threshold" : "10_%", "Percentage_Used" : "0_%", "Data_Units_Read" : "0x328bf4136", "Data_Units_Written" : "0xce0fd0c0", "Host_Read_Commands" : "0x4799737e", "Host_Write_Commands" : "0x2ffad54", "Controller_Busy_Time" : "0xd", "Power_Cycles" : "0x97", "Power_On_Hours" : "0x12ce", "Unsafe_Shutdowns" : "0x83", "Media_Errors" : "0x0", "Number_of_Error_Information_Log_Entries" : "0x0"},
{"diskID": "CVCQ5222000B4444GN.2", "protocol" : 1, "blocks" : 9893021, "block_size" : 512, "max_dma_blocks" : 256, "status" : 1, "pci_root" : 1 , "Serial_Number" : "CVMD438000BL4444GN", "Vendor" : "0x8086", "Model" : "INTEL_SSDPEDME400G4_____________________", "Submission_Queues" : "31", "Completion_Queues" : "31", "MSIX_Interrupts" : "32", "Numa_Node" : "-1", "Critical_Warning" : "0x0", "Temperature" : "306_K", "Available_Spare" : "100_%", "Available_Spare_Threshold" : "10_%", "Percentage_Used" : "0_%", "Data_Units_Read" : "0x328bf4136", "Data_Units_Written" : "0xce0fd0c0", "Host_Read_Commands" : "0x4799737e", "Host_Write_Commands" : "0x2ffad54", "Controller_Busy_Time" : "0xd", "Power_Cycles" : "0x97", "Power_On_Hours" : "0x12ce", "Unsafe_Shutdowns" : "0x83", "Media_Errors" : "0x0", "Number_of_Error_Information_Log_Entries" : "0x0"}
		]
	}
}

def generateFakeReportServer(reportTemplate, generateGUID, nodeID):
	if "node" not in reportTemplate or "disks" not in reportTemplate["node"]:
		raise Exception("Invalid template")

	template = copy.deepcopy(reportTemplate)
	template["node"]["node_id"] = nodeID
	for disk in template["node"]["disks"]:
		if generateGUID:
			diskID = uuid.uuid4()
			disk["diskID"] = "%s.1" % uuid.uuid4()
			disk["Serial_Number"] = str(diskID)
		incrementDiskStats(disk)

	if generateGUID:
		for nic in template["node"]["nics"]:
			nicID = str(uuid.uuid4())
			nic["nicID"] = nicID
			nic["guid"] = nicID

	return template


def incrementDiskStats(disk):
	disk["Data_Units_Read"] = incrementHexFieldRandomally(disk["Data_Units_Read"])
	disk["Data_Units_Written"] = incrementHexFieldRandomally(disk["Data_Units_Written"])


def incrementHexFieldRandomally(hexValue):
	return hex(int(hexValue, 0) + randint(0, 10000))


def postReportServer(session, report):
	res = session.post("%s/servers/report" % MANAGEMENT, json=report, verify=False)
	return res.status_code == 200

def startReporting(numberOfReports, sleep):
	print "PID: %s - Starting to report" % os.getpid()
	session = requests.session()
	#login
	session.post("{}/login".format(MANAGEMENT), params={"username": USERNAME, "password": PASSWORD}, verify=False)

	#report
	generateGUID = True
	report = None
	for i in range(numberOfReports):
		print "PID: %s - Reporting report %d out of %d" % (os.getpid(), i+1, numberOfReports)
		report = generateFakeReportServer(report or reportServer, generateGUID, "target-%s.acme.com" % os.getpid())
		report["node"]["node_id"] = 'nvme47'
		report["node_status"] = 1
		postReportServer(session, report)
		generateGUID = True

		time.sleep(sleep)

	print "PID: %s - Finish to report" % os.getpid()

if __name__ == '__main__':
	processes = []
	for i in range(1):
		p = Process(target=startReporting, args=(1, 0))
		p.start()
		processes.append(p)
		#time.sleep(2)



