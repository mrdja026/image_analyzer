# Gmail Fetcher POC

This is a Gmail Fetcher proof of concept application with an Express.js server.

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   CLIENT_ID=your_google_client_id
   API_KEY=your_google_api_key
   PORT=3000 (optional, defaults to 3000)
   ```

## Running the application

Start the server:

```
npm start
```

For development with auto-reload:

```
npm run dev
```

The application will be available at http://localhost:3000
