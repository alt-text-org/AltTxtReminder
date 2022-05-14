const fs = require("fs");
const util = require("util");

const datejs = require("datejs");
const twitter = require("twitter-api-client");

//users we've already attempted to follow but haven't accepted yet
const outstandingFollowRequests = [];

let lists = {};

const lastDMTweet = {};

const config = {
    lists: process.env.LISTS.split(","),
    userId: process.env.MY_USER,
    twitterClientConfig: {
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        apiKey: process.env.TWITTER_CONSUMER_KEY,
        apiSecret: process.env.TWITTER_CONSUMER_SECRET,
        disableCache: true
    }
};

const messages = {
    default: tweet =>
        `Your tweet has at least one image without a description.\nI'd like to tell you this in the language of your tweet if you'll translate it for me ${tweet}`,
    und: tweet =>
        `Your tweet has at least one image without a description ${tweet}`,

    ar: tweet => `${tweet} تحتوي تغريدتك على صورة بدون وصف`,
    ca: tweet => `El teu tuit conté almenys una imatge sense descripció ${tweet}`,
    cy: tweet => `Mae gan dy neges drydar o leiaf un ddelwedd heb ddisgrifiad ${tweet}`,
    de: tweet =>
        `Dein Tweet enthält mindestens ein Bild ohne Bildbeschreibung ${tweet}`,
    en: tweet =>
        `Your tweet has at least one image without a description ${tweet}`,
    es: tweet => `Tu tuit tiene al menos una imagen sin descripción ${tweet}`,
    fi: tweet =>
        `Twiittisi sisältää ainakin yhden kuvan ilman selitystä ${tweet}`,
    fr: tweet => `Ton tweet a au moins une image sans description ${tweet}`,
    he: tweet => `${tweet} בציוץ שלך יש לפחות תמונה אחת בלי תיאור`,
    hi: tweet => `इस ट्वीट में बिना विवरण के कम से कम एक चित्र है ${tweet}`,
    id: tweet => `twit mengandung gambar tanpa deskripsi ${tweet}`,
    in: tweet =>
        `Tweet Anda memiliki setidaknya satu gambar tanpa deskripsi. ${tweet}`,
    is: tweet =>
        `Tístið þitt inniheldur að minnsta kosti eina mynd sem ekki er lýst ${tweet}`,
    it: tweet =>
        `Il tuo tweet contiene almeno un'immagine senza descrizione ${tweet}`,
    ja: tweet =>
        `あなたのツイートの少なくとも1件は, 決められた描写を満たしていません。 ${tweet}`,
    ka: tweet =>
        `თქვენს ტვიტში როგორც მინიმუმ ერთ სურათს ალტერნატიული ტექსტი არ გააჩნია ${tweet}`,
    ms: tweet =>
        `Tweet anda mempunyai sekurang-kurangnya satu gambar tanpa deskripsi ${tweet}`,
    mk: tweet => `Вашиот твит има барем една слика без описен текст ${tweet}`,
    nb: tweet => `Din tweet har minst ett bilde uten beskrivelse ${tweet}`,
    ne: tweet => `तपाईंको ट्वीटमा कम्तिमा एउटा वर्णन बिनाको चित्र छ। ${tweet}`,
    nl: tweet =>
        `Jouw tweet heeft tenminste één afbeelding zonder beschrijving ${tweet}`,
    pl: tweet =>
        `Twój tweet zawiera co najmniej jeden obrazek bez opisu ${tweet}`,
    pt: tweet => `Este tweet tem pelo menos uma imagem sem descrição ${tweet}`,
    ro: tweet =>
        `Tweet-ul dumneavoastră are cel puțin o imagine fără descriere ${tweet}`,
    ru: tweet => `Ваш твит имеет как минимум одну картинку без описания ${tweet}`,
    sv: tweet =>
        `Din tweet innehåller minst en bild som saknar beskrivning ${tweet}`,
    ta: tweet =>
        `இந்த ட்வீட்டில் விளக்கம் இல்லாமல் குறைந்தது ஒரு படமாவது உள்ளது ${tweet}`,
    tr: tweet =>
        `Tweet'iniz açıklama içermeyen bir ya da birden fazla resim barındırıyor ${tweet}`,
    uk: tweet => `Принайні одне зображення у вашому твіті бракує опису ${tweet}`,
    yi: tweet => `${tweet} דיין טוויט האט אומווייניגסטענס איין בילד אן א באשרייבונג.`
};

function ts() {
    return new Date().toISOString();
}

async function deList(twtr, userId, listId) {
    await twtr.accountsAndUsers
        .listsMembersDestroy({user_id: userId, list_id: listId})
        .then(() => console.log(`Delisted userId: ${userId} from list: ${listId}`))
        .catch(err => console.log(`Failed to delist user: ${JSON.stringify(err)}`));
}

async function sendDM(twtr, tweet, listId) {
    let tweetLink = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
    let message;
    if (tweet.lang && messages[tweet.lang]) {
        message = messages[tweet.lang](tweetLink);
    } else if (tweet.user.lang && messages[tweet.user.lang]) {
        message = messages[tweet.user.lang](tweetLink);
    } else {
        message = messages.default(tweetLink);
    }

    if (lastDMTweet[tweet.user.id_str] === tweet.id_str) {
        console.log(
            `${ts()}: Got duplicate DM request for ${tweet.user.screen_name}`
        );
        deList(twtr, tweet.user.id_str, listId);
        return;
    }

    await twtr.directMessages
        .eventsNew({
            event: {
                type: "message_create",
                message_create: {
                    target: {
                        recipient_id: tweet.user.id_str
                    },
                    message_data: {
                        text: message
                    }
                }
            }
        })
        .then(resp => {
            if (resp.event && resp.event.id) {
                console.log(`${ts()}: DMed: ${message}`);
                lastDMTweet[tweet.user.id_str] = tweet.id_str;
            } else {
                console.log(`Failed to send DM. Status: ${JSON.stringify(resp)}`);
            }
        })
        .catch(err => {
            if (err.statusCode === 403) {
                console.log(`Unfollowing ${tweet.user.screen_name}`);
                unfollow(twtr, tweet.user.id_str);
            } else {
                console.log("DM Error: " + JSON.stringify(err));
            }
        });
}

function hasImageWithoutAltText(tweet) {
    let entities = tweet["extended_entities"];
    if (!entities) {
        return false;
    }

    let media = entities["media"];
    if (!media) {
        return false;
    }

    let hasPicWithoutAltText = false;
    media.forEach(m => {
        if (
            (m["type"] === "photo" || m["type"] === "animated_gif") &&
            !m["ext_alt_text"]
        ) {
            hasPicWithoutAltText = true;
        }
    });

    return hasPicWithoutAltText;
}

async function getListRecord(twtr, listId) {
    let lastSeen;
    try {
        lastSeen = fs.readFileSync(`lists/${listId}.tweet`, "utf8");
    } catch (err) {
        if (err.code === "ENOENT") {
            console.log(`${ts()}: No file found for list: ${listId}`);
            lastSeen = null;
        } else {
            throw err;
        }
    }

    return {
        id: listId,
        lastSeen: lastSeen
    };
}

function markLastTweetsSeen(list, tweets) {
    let last = tweets.sort(
        (t1, t2) => Date.parse(t2.created_at) - Date.parse(t1.created_at)
    )[0];

    fs.writeFileSync(`lists/${list.id}.tweet`, last.id_str);
    list.lastSeen = last.id_str;
}

async function fetchListTweets(twtr, list) {
    let params;
    if (list.lastSeen) {
        params = {
            list_id: list.id,
            since_id: list.lastSeen,
            include_rts: false,
            include_entities: true,
            include_ext_alt_text: true,
            tweet_mode: "extended"
        };
    } else {
        params = {
            list_id: list.id,
            include_rts: false,
            include_entities: true,
            include_ext_alt_text: true,
            count: 1,
            tweet_mode: "extended"
        };
    }

    return twtr.accountsAndUsers.listsStatuses(params);
}

function poll(twtr, list) {
    return async () => {
        let newTweets = await fetchListTweets(twtr, list).catch(err => {
            console.log(`${ts()}: Failed to fetch tweets for list: ${list.id}`);
            console.log(err);
            return [];
        });
        let badTweets = newTweets.filter(hasImageWithoutAltText);

        for (let i = 0; i < badTweets.length; i++) {
            await sendDM(twtr, badTweets[i], list.id);
        }

        if (newTweets.length > 0) {
            markLastTweetsSeen(list, newTweets);
        }
    };
}

async function getLists(twtr) {
    let lists = [];

    let promises = config.lists.map(async listId => {
        let list = await twtr.accountsAndUsers
            .listsMembers({
                list_id: listId,
                count: 5000,
                include_entities: false,
                skip_status: true
            })
            .catch(err => {
                console.log(err);
                throw err;
            });

        let memberIds = {};
        list.users.forEach(member => (memberIds[member.id_str] = true));

        lists.push({
            ids: memberIds,
            listId: listId
        });
    });

    await Promise.all(promises).catch(e => console.log(e));

    return lists;
}

function chunk(arr, chunkSize) {
    let result = [];
    for (let i = 0, len = arr.length; i < len; i += chunkSize) {
        result.push(arr.slice(i, i + chunkSize));
    }

    return result;
}

async function getProtectedUsers(twtr, followers) {
    let locked = [];
    let batches = chunk(followers, 100);
    for (const batch of batches) {
        await twtr.accountsAndUsers
            .usersLookup({
                user_id: batch.join(","),
                include_entities: false
            })
            .then(result => {
                result
                    .filter(user => user.protected)
                    .forEach(user => {
                        locked.push(user.id_str);
                    });
            })
            .catch(err => {
                console.log(`${ts()}: Error fetching user info: ${err}`);
            });
    }

    return locked;
}

//get accounts following @AltTxtReminder (aka followers)
async function getFollowers(twtr) {
    let followers = [];
    let cursor = -1;

    do {
        let batch = await twtr.accountsAndUsers.followersIds({
            user_id: config.userId,
            count: 5000,
            stringify_ids: true,
            cursor: cursor
        }).catch(e => console.log(e));

        batch.ids.forEach(id => followers.push(id));
        cursor = batch.next_cursor_str;
    } while (cursor && cursor > 0);

    return followers;
}

//get accounts @AltTxtReminder is following (aka friends)
async function getFriends(twtr) {
    let friends = {};
    let cursor = -1;

    do {
        let batch = await twtr.accountsAndUsers.friendsIds({
            user_id: config.userId,
            count: 5000,
            stringify_ids: true,
            cursor: cursor
        }).catch(e => console.log(e));

        batch.ids.forEach(id => (friends[id] = true));
        cursor = batch.next_cursor_str;
    } while (cursor && cursor > 0);

    return friends;
}

async function addToList(twtr, lists, userIds) {
    const chunks = chunk(userIds, 100);

    let results = chunks.map(chunk => {
        let list = lists.find(
            list => Object.keys(list.ids).length + chunk.length <= 5000
        );

        if (!list) {
            throw {err: `Couldn't find list with room for ${chunk.length} users!`};
        }

        return twtr.accountsAndUsers
            .listsMembersCreateAll({
                list_id: list.listId,
                user_id: chunk.join(",")
            })
            .then(() => {
                console.log(
                    `${ts()}: Added ${chunk.join(", ")} to list ${list.listId}`
                );
                chunk.forEach(userId => list.ids[userId] = true);
            })
    })

    await Promise.all(results).catch(e => console.log(`${ts()}: Error enlisting batch: ${e}`))
}

async function followUser(twtr, userId) {
    await twtr.accountsAndUsers.friendshipsCreate({
        user_id: userId,
        follow: true
    });
}

function checkFollows(twtr) {
    return async () => {
        let followers = await getFollowers(twtr);
        let friends = await getFriends(twtr);
        let lists = await getLists(twtr);
        let protectedUsers = await getProtectedUsers(twtr, followers);

        let enlisted = lists
            .map(list => Object.keys(list.ids).length)
            .reduce((a, b) => a + b, 0);
        console.log(
            `${ts()}: Found ${followers.length} followers, ${
                Object.keys(friends).length
            } friends, ${lists.length} lists with ${enlisted} members`
        );

        let unlisted = followers.filter(follower => {
            let memberOf = lists.filter(list => list.ids[follower] || false);
            return memberOf.length === 0;
        });

        protectedUsers.forEach(user => {
            if (!friends[user]) {
                const index = unlisted.indexOf(user);
                if (index > -1) {
                    unlisted.splice(index, 1);
                }
            }
        });

        if (unlisted.length > 0) {
            console.log(
                `${ts()}: Attempting to add ${unlisted.length} users to a list`
            );

            try {
                await addToList(twtr, lists, unlisted);
            } catch (err) {
                console.log(err);
            }
        } else {
            console.log(`${ts()}: No unlisted users found`);
        }

        let unfollowed = followers.filter(
            follower =>
                !friends[follower] && !outstandingFollowRequests.includes(follower)
        );
        if (unfollowed.length > 0) {
            console.log(`Currently ${unfollowed.length} users need to be followed.`);
            console.log(
                `Currently ${outstandingFollowRequests.length} accounts are outstanding follow requests.`
            );
            //lets only try to follow 5 users at a time max
            let followersToFollow = unfollowed.slice(0, 8);
            console.log(
                `${ts()}: Attempting to follow ${followersToFollow.length} users`
            );
            followersToFollow.forEach(async userId => {
                try {
                    await followUser(twtr, userId);
                    console.log(`Successfully followed user: ${userId}`);
                } catch (err) {
                    console.log(`Failed to follow user: ${userId}: ${JSON.stringify(err)}`);
                    try {
                        let jsonErr = JSON.parse(err.data);
                        if (jsonErr.errors[0].code === 160) {
                            //add user to our in-memory list of people we've already tried to follow
                            outstandingFollowRequests.push(userId);
                        }
                    } catch (err) {
                        console.log(err);
                    }
                }
            });
        } else {
            console.log(`${ts()}: No unfollowed users found`);
        }
    };
}

async function unfollow(twtr, userId) {
    //  await twtr.accountsAndUsers.blocksCreate({user_id: userId});
    await twtr.accountsAndUsers
        .friendshipsDestroy({user_id: userId})
        .catch(err =>
            console.log(`Failed to unfollow user ${userId}: ${JSON.stringify(err)}`)
        );
    Object.keys(lists).forEach(listId => delist(twtr, userId, listId));
}

async function delist(twtr, userId, listId) {
    await twtr.accountsAndUsers
        .listsMembersDestroy({
            user_id: userId,
            list_id: listId
        })
        .catch(err => {
                if (err.statusCode !== 404) {
                    console.log(
                        `Failed to delist user ${userId} from ${listId}: ${JSON.stringify(
                            err
                        )}`
                    );
                }
            }
        )
}

function dedupLists(twtr) {
    return () => {
        const lists = getLists(twtr);
        for (let i = 0; i < lists.length - 1; i++) {
            Object.keys(lists[i].ids).forEach(userId => {
                for (let j = i + 1; j < lists.length; j++) {
                    if (lists[j].ids[userId]) {
                        delist(twtr, userId, lists[j].listId)
                    }
                }
            })
        }
    }
}

function checkForNewTweets(twtr, lists) {
    return async () => {
        for (let i = 0; i < lists.length; i++) {
            await poll(twtr, lists[i])();
        }
    };
}

async function run() {
    const twtr = new twitter.TwitterClient(config.twitterClientConfig);

    let listsPromise = config.lists
        .map(async listId => {
            return await getListRecord(twtr, listId);
        })
        .filter(list => list != null);

    lists = await Promise.all(listsPromise);

    console.log(`${ts()}: Found lists:`);
    console.log(lists);

    setInterval(checkForNewTweets(twtr, lists), lists.length * 1500);
    setInterval(checkFollows(twtr), 5 * 60 * 1000);
    setInterval(dedupLists(twtr), 10 * 60 * 1000);
}

run();
