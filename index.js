const server = require('express')
const path = require('path');
const app = server()


const puppeteer = require("puppeteer-extra");
const fs = require('fs');
var Sentiment = require("sentiment");


// custom script
let tampung_komen =[];
async function export_txt(arr_obj){
  let data_komen = JSON.stringify(arr_obj);
  fs.writeFile('data_komen.json', data_komen, 'utf-8', function(err){
    if(err){
      console.log('Gagal disimpan');
    }
    else{
      console.log('tersimpan');
    }

  })
}
// custom script



app.use(server.static(path.join(__dirname, 'public')));
app.get('/', function(req, res){
    
    res.sendFile(path.join(__dirname, '/public/index.html'));
    res.end()
})

app.get('/ambil_komentar',function(req, res){
    let rq = req.query
    if('url' in rq){
        let url = rq.url
        if(url!=''){
            
            ///karena function async maka then juga harus async
            run(url).then(async function(){
                res.header('Content-type:application/json')
                res.send(tampung_komen)
            })

            
            
        }
        else{
            res.sendStatus(404);
            res.end()
        }
        
    }
    else{
        res.sendStatus(404);
        res.end()
    }
    
})




const sentiment = (text) => new Sentiment().analyze(text);
let post = async function (comment_object) {
  console.log(comment_object);

  // push object ke array tampung komen
  tampung_komen.push(comment_object)
};
let getIdFromTwitterUrl = function (url) {
  return url.split("/")[url.split("/").length - 1];
};
let yOffsetMap = [];
let visitedUrls = [];
let tweetMap = {};
async function autoScroll(num_scrolls, page) {
  let offsets = await page.evaluate(async (num_scrolls) => {
    return await new Promise((resolve, reject) => {
      var distance = 100;
      var scrollCount = 0;
      var totalHeight = 0;
      var timer = setInterval(() => {
        scrollCount++;

        window.scrollBy(0, distance);

        totalHeight += distance;
        if (scrollCount >= num_scrolls) {
          clearInterval(timer);
          resolve(window.pageYOffset);
        }
      }, 100);
    });
  }, num_scrolls);
  yOffsetMap = yOffsetMap.map((e) => {
    if (e.id === page.mainFrame()._id) {
      if (!e.offsets) e.offsets = [];
      e.offsets.push(offsets);
      return { id: e.id, offsets: e.offsets };
    }
    return e;
  });
}
function checkDoneScrolling(id) {
  let answer = false;
  yOffsetMap.forEach((e) => {
    if (e.id.toString() == id.toString()) {
      if (!e.offsets || e.offsets.length < 11) return;
      if (
        e.offsets[e.offsets.length - 1].toString() ==
        e.offsets[e.offsets.length - 10].toString()
      ) {
        answer = true;
      }
    }
  });
  return answer;
}
async function getSubTweetUrls(page) {
  let subTweetUrls = [];
  yOffsetMap.forEach((yOffset) => {
    if (yOffset.id == page.mainFrame()._id) yOffset.offsets = [];
  });
  while (!checkDoneScrolling(page.mainFrame()._id)) {
    try {
      await autoScroll(1, page);
      const results = await page.$$eval("article ", (tweets) => {
        if (!tweets || tweets == null) return [];
        tweets = tweets.splice(1, tweets.length);
        return tweets.map((tweet) => {
          try {
            if (!tweet || tweet == null) return 0;
            if (
              !tweet.querySelectorAll("time") ||
              tweet.querySelectorAll("time") == null ||
              !tweet.outerHTML
            )
              return 0;

            //fallback mechanism to enter null if selector cannot retreive

            let _published = null;
            let _replies = null;
            let _retweets = null;
            let _likes = null;
            let _error = null;
            let _url = [...tweet.querySelectorAll("a")]
              .map((e) => e.getAttribute("href"))
              .filter((e) => e.includes("status") && !e.includes("photo"))[0];

            try {
              //find tweetmap data

              _published = tweet
                .querySelectorAll("time")[0]
                .getAttribute("datetime");
              if (tweet.outerHTML.match("[0-9]+ .etweets"))
                _retweets = tweet.outerHTML
                  .match("[0-9]+ .etweets")[0]
                  .split(" ")[0];
              else
                _retweets = tweet.outerHTML
                  .match("[0-9]+ .etweet")[0]
                  .split(" ")[0];
              if (tweet.outerHTML.match("[0-9]+ .ikes"))
                _likes = tweet.outerHTML.match("[0-9]+ .ikes")[0].split(" ")[0];
              else
                _likes = tweet.outerHTML.match("[0-9]+ .ike")[0].split(" ")[0];
              if (tweet.outerHTML.match("[0-9]+ .eplies"))
                _replies = tweet.outerHTML
                  .match("[0-9]+ .eplies")[0]
                  .split(" ")[0];
              else
                _replies = tweet.outerHTML
                  .match("[0-9]+ .eply")[0]
                  .split(" ")[0];
            } catch (ex) {
              _error = ex.toString();
            }
            //populate tweetmap

            return {
              url: _url,
              published: _published,
              replies: _replies,
              retweets: _retweets,
              likes: _likes,
              error: _error,
            };
          } catch (e) {
            console.log("puppeteer error");
            console.log(e);
            return 0;
          }
        });
      });

      subTweetUrls.push(...results.filter((e) => e !== 0));

      subTweetUrls.forEach((subTweet) => {
        if (!subTweet || !subTweet.url) return;
        let id = subTweet.url.split("/")[subTweet.url.split("/").length - 1];
        if (!tweetMap[id]) {
          tweetMap[id] = {
            published: subTweet.published,
            replies: subTweet.replies,
            retweets: subTweet.retweets,
            likes: subTweet.likes,
            error: subTweet.error,
          };
        }
      });
      //hit show more replies button
      await page.$$eval("div > div > div > div > span", (spans) => {
        let loadMoreClicked = false;
        try {
          spans.forEach((s) => {
            if (s.innerHTML.toLowerCase().match(".*show more replies.*")) {
              s.click();
              loadMoreClicked = true;
            }
          });
          let spanz = document.querySelectorAll(
            "div > div > div > span > span"
          );
          spanz.forEach((s) => {
            if (s.innerHTML.toLowerCase().match(".*show.*")) {
              s.click();
              loadMoreClicked = true;
            }
          });
        } catch (errz) {
          loadMoreClicked = false;
        }
        return loadMoreClicked;
      });
    } catch (exc) {
      console.log(exc);
      continue;
    }
  }
  let return_result = Array.from(new Set(subTweetUrls.map((a) => a.url)))
    .map((url) => {
      return subTweetUrls.find((a) => a.url === url);
    })
    .map((item) => item.url);
  let l = return_result.length;
  return_result.splice(0, return_result.indexOf(page.url()) - 1);

  return return_result
    .filter((i) => i && !page.url().includes(i))
    .map((f) => "https://twitter.com" + f);
}
let run = async function (base_url) {
  let browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
  });
  let page = await browser.newPage();
  await page.setDefaultNavigationTimeout(0);
  yOffsetMap.push({ id: page.mainFrame()._id });

  visitedUrls = [];
  await recursiveCommentsCrawler(base_url, false, base_url, page);
  browser.close()
};

let recursiveCommentsCrawler = async function (
  base_url,
  parent_url,
  comment_url,
  page
) {
  if (comment_url.split("/")[comment_url.split("/").length - 1] == "people")
    return;
  visitedUrls.push(comment_url);
  await page.goto(comment_url, {
    waitUntil: "networkidle0",
  });
  let eval_payload = await page.$$eval("article > div > div", (divs) => {
    let result = [];
    divs.forEach((t) => {
      let smallDivs = t.querySelectorAll("div > div > div > div");
      smallDivs.forEach((x) => {
        if (x.getAttribute("lang") !== null) {
          let body = null;
          if(!x.querySelectorAll("span") || x.querySelectorAll("span").length<1)
          return;
          else
          body = x.querySelectorAll("span")[0].innerHTML;
          if (!x) return;
          //to navigate from body div to username, go 3 parents up and back 1, query all spans with innerHTML starting @
          let uName = x.parentNode.parentNode.parentNode.previousSibling;
          if (!uName) return;
          uName = uName.querySelectorAll("span");
          uName = Array.from(uName)
            .map((m) => (m.innerHTML[0] === "@" ? m.innerHTML : undefined))
            .filter((f) => f);
          if (uName.length > 0) {
            try {
              while (true) {
                x = x.parentNode;
                if (x.tagName.toLowerCase() == "article") break;
              }
              time = x.querySelectorAll("time")[0].getAttribute("datetime");
              retweets_count = x.outerHTML
                .match("[0-9]+ .etweets")[0]
                .split(" ")[0];
              likes_count = x.outerHTML.match("[0-9]+ .ikes")[0].split(" ")[0];
            } catch (excn) {}

            result.push({
              uName: uName[0],
              body: body,
            });
          } else return [];
        }
      });
    });
    return result[result.length - 1];
  });
  if (parent_url !== false && eval_payload) {
    await post({
      parentUrl: parent_url,
      commentUrl: comment_url,
      baseUrl: base_url,
      username: "@" + comment_url.split("twitter.com/")[1].split("/status")[0],
      body: eval_payload.body,
      sentiment: sentiment(eval_payload.body).score,
      likes_count: tweetMap[getIdFromTwitterUrl(comment_url)].likes,
      retweet_count: tweetMap[getIdFromTwitterUrl(comment_url)].retweets,
      replies_count: tweetMap[getIdFromTwitterUrl(comment_url)].replies,
      published_datetime: tweetMap[getIdFromTwitterUrl(comment_url)].published,
      error: tweetMap[getIdFromTwitterUrl(comment_url)].error,
    });
  }
  let children = await getSubTweetUrls(page);
  children = children.filter((c) => c !== parent_url);
  children = children.filter((c) => c !== base_url);
  children = children.filter((c) => c !== comment_url);
  // console.log(children);
  if (children.length == 0) return true;
  else {
    for (let i = 0; i < children.length; i++) {
      if (visitedUrls.includes(children[i])) continue;
      await recursiveCommentsCrawler(base_url, comment_url, children[i], page);
    }
    console.log('selesai');
    export_txt(tampung_komen)
  }

  return true;
};




app.listen(8080)
console.log('RUning server....')
