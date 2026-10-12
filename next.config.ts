import type { NextConfig } from "next";

// 카카오톡/네이버/다음 링크 미리보기 크롤러는 <head> 의 메타태그만 읽는다.
// Next 기본 봇 목록(기본값을 덮어쓰므로 그대로 포함)에 한국 서비스 크롤러를 추가해
// 이 봇들에게는 메타데이터를 스트리밍하지 않고 <head> 에 바로 내려준다.
const htmlLimitedBots = new RegExp(
  [
    "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou",
    "bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview",
    "applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot",
    "WhatsApp|SkypeUriPreview|Yeti|googleweblight",
    "kakaotalk|kakaostory|daum|naverbot|line-poker",
  ].join("|"),
  "i",
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // mongodb 는 번들하지 않고 Node 에서 그대로 로드한다
  serverExternalPackages: ["mongodb"],
  htmlLimitedBots,
};

export default nextConfig;
