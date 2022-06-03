const twitterV2 = require("twitter-api-v2");

const config = {
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    apiKey: process.env.TWITTER_CONSUMER_KEY,
    apiSecret: process.env.TWITTER_CONSUMER_SECRET,
};

async function go() {
    const client = new twitterV2.TwitterApi({ appKey: config.apiKey, appSecret: config.apiSecret });
    const authLink = await client.generateAuthLink()
    console.log(JSON.stringify(authLink))
}

go();
