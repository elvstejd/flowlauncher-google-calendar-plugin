const { google } = require('googleapis');
const open = require('open');
const fs = require('fs');
const path = require('path');
const http = require('http');
const chrono = require('chrono-node');
const WindowsToaster = require('node-notifier').WindowsToaster;



const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const timeZone = 'America/Santo_Domingo';

const { method, parameters } = JSON.parse(process.argv[2]);

async function authenticateGoogle() {
	const tokenPath = path.join(__dirname, 'token.json');
	const credentialsPath = path.join(__dirname, 'credentials.json');

	const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
	const { client_secret, client_id, redirect_uris } = credentials.installed;
	const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

	if (fs.existsSync(tokenPath)) {
		const savedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
		oAuth2Client.setCredentials(savedTokens);
	} else {
		const authUrl = oAuth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: SCOPES,
		});

		// Open the URL in the default browser
		await open(authUrl);

		// Start a local server to capture the code
		const port = 80;
		await new Promise((resolve, reject) => {
			const server = http.createServer(async (req, res) => {
				const queryObject = new URL(req.url, `http://localhost:${port}`).searchParams;
				const code = queryObject.get('code');
				if (code) {
					try {
						const { tokens } = await oAuth2Client.getToken(code);
						oAuth2Client.setCredentials(tokens);
						fs.writeFileSync(tokenPath, JSON.stringify(tokens));
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Authentication successful! You can close this window.');
						server.close(resolve);
					} catch (error) {
						reject(error);
					}
				} else {
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('No code found in the URL query string.');
				}
			});

			server.listen(port, () => {
				console.log(`Listening on http://localhost:${port}`);
			});
		});
	}

	return google.calendar({ version: 'v3', auth: oAuth2Client });
}




if (method === "query") {
	// if parameters is an empty string, ask user to provide a title
	if (parameters[0] === "") {
		respondWith({
			"result": [{
				"Title": "Provide a title for your event",
				"Subtitle": "Eg. 'Meeting with John tomorrow at 3pm'",
				"IcoPath": "Images\\app.png"
			}]
		})
		return;
	} else {
		logEvent(`Querying for: ${parameters}`);
		respondWith({
			"result": [{
				"Title": `${parameters}`,
				"Subtitle": "Hit Enter to create the event",
				"JsonRPCAction": {
					"method": "create_event",
					"parameters": [parameters]
				},
				"IcoPath": "Images\\app.png"
			}]
		});
	}
}

if (method === "create_event") {
	const eventTitle = parameters[0];
	createEvent(eventTitle);
}

async function createEvent(eventTitle) {
	logEvent(`Creating event: ${eventTitle}`);
	const calendar = await authenticateGoogle();

	respondWith({
		method: "Flow.Launcher.HideApp",
		parameters: ["Creating event...", false]
	})

	// Extract date and time from the event title using chrono-node
	eventTitle = eventTitle.toString();
	const parsedResults = chrono.parse(eventTitle);

	let startDate, endDate;

	// If a date is found, use it. Otherwise, use the current date and time.
	if (parsedResults.length > 0) {
		startDate = parsedResults[0].start.date();
		if (parsedResults[0].end) {
			endDate = parsedResults[0].end.date();
		} else {
			endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour later by default
		}

		// Remove the parsed date/time from the event title
		const parsedText = parsedResults[0].text;
		eventTitle = eventTitle.replace(parsedText, '').trim();
	} else {
		startDate = new Date();
		endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour later by default
	}

	const event = {
		summary: eventTitle,
		start: {
			dateTime: startDate.toISOString(),
			timeZone: timeZone,
		},
		end: {
			dateTime: endDate.toISOString(),
			timeZone: timeZone,
		},
	};

	try {
		const response = await calendar.events.insert({
			calendarId: 'primary',
			resource: event,
		});
		// Log the response to the event log
		logEvent(`Event created: ${response}`);

		// Show a notification
		const notifier = new WindowsToaster({
			withFallback: false,
			customPath: undefined
		});

		notifier.notify({
			title: 'Event created',
			message: eventTitle,
			icon: path.join(__dirname, 'Images', 'app.png'),
			sound: true,
			wait: false,
			appID: 'Google Calendar',
		});

	} catch (error) {
		// Log the error to the error log
		logEvent(`Error creating event: ${error}`);
	}
}

function respondWith(response) {
	console.log(JSON.stringify(response));
}

function logEvent(message) {
	fs.appendFileSync('event.log', `${message}\n`);
}