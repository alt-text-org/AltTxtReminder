const twitterV2 = require("twitter-api-v2");

const config = {
    twitterClientConfig: {
        apiKey: process.env.TWITTER_CONSUMER_KEY,
        apiSecret: process.env.TWITTER_CONSUMER_SECRET,
        oauthToken: process.env.TWITTER_OAUTH_TOKEN,
        oauthTokenSecret: process.env.TWITTER_OAUTH_TOKEN_SECRET,
        oauthPin: process.env.TWITTER_OAUTH_PIN,
    }
};

function ts() {
    return new Date().toISOString();
}

async function addToListV2(twtr2, listId, userId) {
    return await twtr2.v2.addListMember(listId, userId)
        .then(resp => {
            if (resp.errors && resp.errors.length > 0) {
                console.log(`${ts()}: Failed to add member to list: ${JSON.stringify(resp.errors)}`);
                return false;
            }
            return true;
        })
        .catch(err => {
            console.log(`${ts()}: Failed to add member to list: ${err}`);
            return false;
        })
}


(async () => {
    const twtr2API = new twitterV2.TwitterApi({
        appKey: config.twitterClientConfig.apiKey,
        appSecret: config.twitterClientConfig.apiSecret,
        accessToken: config.twitterClientConfig.oauthToken,
        accessSecret: config.twitterClientConfig.oauthTokenSecret
    })
    const loggedIn = await twtr2API.login(config.twitterClientConfig.oauthPin)
        .catch(e => {
            console.log(`${ts()}: Failed to login:`)
            console.log(e)
            return null;
        });

    if (!loggedIn) {
        return
    }

    const result = await addToListV2(loggedIn.client, '1374411505031020550', '2987077829')
    console.log(`${ts()}: Added: ${result}`)
})();