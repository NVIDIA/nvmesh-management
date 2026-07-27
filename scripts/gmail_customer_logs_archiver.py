#!/usr/bin/env python2

import base64
import json
from datetime import datetime
import pymongo
from googleapiclient.discovery import build
from httplib2 import Http
from oauth2client import file, client, tools
from datetime import date, timedelta

######### Python Dependencies #########
# pymongo
# google-api-python-client
# oauth2client


################ USAGE ################
#
# Configuring a New Google Account:
#
#	Step 1: Create a new Project in Google developer console:
#		Go to https://console.developers.google.com login in with the new account, and create a new Project
#
#   Step 2: Enable gmail API and download credentials.json file:
#			This stpe is only required if we need to configure this script to work with a new google account (this is already pre-configured to work with customer.stats@excelero)
# 			To enable gmail api please visit https://console.developers.google.com/apis/api/gmail.googleapis.com/overview
#
#	Step 3: Get credentials.json:
# 			To create the credentials.json file go to your project / credentails: https://console.developers.google.com/apis/credentials
# 			Create new Credentials of type 'other', call it python-client

# Configuring the Script to work on a new Machine:
#
# 	Step 1: Download credentials
#			In google developer console on your project / credentails: https://console.developers.google.com/apis/credentials
# 			Click on the download icon ('Download JSON') that appear on the rght of the credentials row.
#			this will download the credentials, put this file in the same folder as this script and rename it 'credentials.json'
#
# 	Step 2: Perform Auth Login:
# 			Run the script for the first time
# 			a Web page will open in your browser
#			(if you run the script on a remote machine please use: ./gmail_customer_logs_archiver.py --noauth_local_webserver )
# 			perform the Auth login using the user that you want to access it's gmail account
#
# 	Step 3: setup cronjob for this script
# 			run `crontab -e`
# 			recommended configuration: once every 5 minutes:
#			*/5 * * * * /home/gil/gmail_customer_logs_archiver.py 2>&1 | /usr/bin/logger -t customer_logs_archiver
#
#			the logs will appear in the system logs, to view run the command:
#			$ sudo tailf /var/log/messages | grep customer_logs_archiver
#
# 	Step 4: Setup MongoDB
# 			Make sure you have a MongoDB server running on localhost:27017
#			If the mongo address is different you can edit the following line with the correct address and port:
#			db = MongoDBService('mongodb://<mongodb.host>:<mongodb.port>/)
#
# 	Step 5: Install python dependencies
#			To install all required python dependencies run the following:
# 			sudo pip install pymongo google-api-python-client oauth2client



########### How To Query the Database #########
#
# Database Query Example: List all error from customer 'customerName'
#	Place this in a mongo shell / Robomongo client
#
# db.getCollection('logs').aggregate([
# 	{'$match': {'customerName': 'customerName'}},
# 	{'$project': {'data.errors': 1}},
# 	{'$unwind': '$data.errors'},
# 	{'$project': {'error': '$data.errors'}},
# ])

SCOPES = 'https://www.googleapis.com/auth/gmail.readonly'

# The file token.pickle stores the user's access and refresh tokens, and is
# created automatically when the authorization flow completes for the first
# time.
TOKEN_FILE = '/etc/opt/token.pickle'

CREDENTIALS_FILE = '/etc/opt/credentials.json'

class MongoDBService(object):
	DEFAULT_SERVER_ADDRESS = 'mongodb://localhost:27017/'
	SERVER_TIMEOUT_MS = 3000
	DB_NAME = 'customer-logs'
	COLLECTION_PROCESSED = 'processed'
	COLLECTION_LOGS = 'logs'
	COLLECTION_STATS = 'stats'

	def __init__(self, serverAddress=None):
		self.serverAddress = serverAddress or MongoDBService.DEFAULT_SERVER_ADDRESS
		self.mongoClient = self._getMongoClient()
		self.db = self.mongoClient[MongoDBService.DB_NAME]
		self.processed = self.db[MongoDBService.COLLECTION_PROCESSED]
		self.logs = self.db[MongoDBService.COLLECTION_LOGS]
		self.stats = self.db[MongoDBService.COLLECTION_STATS]

	def _getMongoClient(self):
		try:
			mongoClient = pymongo.MongoClient(self.serverAddress, serverSelectionTimeoutMS=MongoDBService.SERVER_TIMEOUT_MS)

			# check if alive
			mongoClient.server_info()
			return mongoClient
		except pymongo.errors.ServerSelectionTimeoutError as ex:
			raise Exception("Error Connecting to MongoDB server on {}".format(self.serverAddress))

	def isProcessed(self, messageID):
		messageEntry = self.processed.find_one({"_id": messageID})
		return bool(messageEntry)

	def markProcessed(self, messageID, error=None, msgPayload=None):
		doc = {
			'_id': messageID,
			'dateProcessed': datetime.now(),
		}

		if error:
			doc['error'] = error

		if msgPayload:
			doc['msgPayload'] = msgPayload

		result = self.processed.insert_one(doc)
		return result

	def saveUserStats(self, document):
		result = self.stats.insert_one(document)
		return result

	def saveUserLogs(self, document):
		result = self.logs.insert_one(document)
		return result

class ProcessGmailMessageError(Exception):
	def __init__(self, errorMsg=None, gmailMessage=None, gmailMsgBody=None):
		Exception.__init__(self, errorMsg)
		self.gmailMessage = gmailMessage
		self.gmailMsgBody = gmailMsgBody

class CustomerLogsArchiver(object):
	def __init__(self, db):
		self.db = db
		self.service = None
		self.apiLogin()

	def apiLogin(self):
		store = file.Storage(TOKEN_FILE)
		creds = store.get()
		if not creds or creds.invalid:
			flow = client.flow_from_clientsecrets(CREDENTIALS_FILE, SCOPES)
			creds = tools.run_flow(flow, store)
		self.service = build('gmail', 'v1', http=creds.authorize(Http()))

	def _buildQuery(self):
		today = date.today()
		yesterday = today - timedelta(1)

		# Dates have to formatted in YYYY/MM/DD format for gmail
		query = "after: {0}".format(yesterday.strftime('%Y/%m/%d'))
		return query

	def _getMessageList(self):
		query = self._buildQuery()
		results = self.service.users().messages().list(userId='me', q=query, labelIds=['INBOX']).execute()
		messages = results.get('messages', [])
		return messages

	def archiveNewEmails(self):
		messages = self._getMessageList()
		noMessagesProcessed = True

		if not messages:
			print "No messages found."
		else:
			for message in messages:
				messageID = message['id']
				if not self.db.isProcessed(messageID):
					noMessagesProcessed = False
					msg = self.service.users().messages().get(userId='me', id=messageID).execute()
					try:
						self.processMessage(messageID, msg)
						self.db.markProcessed(messageID)
					except ProcessGmailMessageError as ex:
						print('Error processing message. Error: %s. Message: %s' % (ex, msg))
						self.db.markProcessed(messageID, error=ex, msgPayload=ex.gmailMsgBody)

					except Exception as ex:
						print('Error processing message. Error: %s. Message: %s' % (ex, msg))
						self.db.markProcessed(messageID, error=ex)

		if noMessagesProcessed:
			print("No new messages to process")

	def processMessage(self, messageID, msg):
		fromWho = None
		subject = None
		received = None
		toWho = None
		headers = msg['payload']['headers']

		for h in headers:
			if h['name'].lower() == 'from':
				fromWho = h['value']
			elif h['name'].lower() == 'subject':
				subject = h['value']
			elif h['name'].lower() == 'to':
				toWho = h['value']
			elif h['name'].lower() == 'date':
				received = h['value']

		if 'Management System Mails' in fromWho:
			customerName = None
			content = None

			try:
				customerName = toWho.split('@')[0].split('+')[1]
			except IndexError as ex:
				print('Customer Name not found in email recipient %s. Error: %s' % (toWho, ex))

			try:
				content = msg['payload']['body']['data']
				content = base64.b64decode(content).decode('utf-8')
				content = content.replace('\r','')
				content = content.replace('\n','')
				data = json.loads(content)
			except Exception as ex:
				errorMsg = 'Error parsing data from message. Error: %s ' % (ex)
				raise ProcessGmailMessageError(errorMsg=errorMsg, gmailMessage=msg, gmailMsgBody=content)

			try:
				self.processData(messageID, data, customerName, received, msg)
			except Exception as ex:
				errorMsg = 'Error processing data from %s received: %s. Error: %s data: %s ' % (customerName, received, ex, data)
				raise ProcessGmailMessageError(errorMsg=errorMsg, gmailMessage=msg, gmailMsgBody=content)

	def processData(self, messageID, data, customerName, received, msg):
		if not customerName:
			print('Received data without customer name. Received: %s Data: %s' % (received, data))

		if not 'messageType' in data:
			print('No Message type found in Data from %s received: %s data: %s ' % (data['messageType'], customerName, received, data))
			return

		if data['messageType'] == 'stats':
			print('Processing Stats Data from %s received: %s data: %s ' % (customerName, received, data))

			document = {
				'_id': messageID,
				'customerName': customerName,
				'dateReceived': received,
				'data': data
			}

			if not customerName:
				document['fullMessage'] = msg

			self.db.saveUserStats(document)
		elif data['messageType'] == 'log':
			print('Processing Log message from %s received: %s data: %s ' % (customerName, received, data))
			document = {
				'_id': messageID,
				'customerName': customerName,
				'dateReceived': received,
				'level': data['level'],
				'message': data['message']
			}

			self.db.saveUserLogs(document)
		else:
			print('Unknown Message type %s Data from %s received: %s data: %s ' % (data['messageType'], customerName, received, data))

if __name__ == '__main__':
	db = MongoDBService()
	archiver = CustomerLogsArchiver(db)
	archiver.archiveNewEmails()

