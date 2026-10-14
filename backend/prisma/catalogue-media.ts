// Contextual stock photographs, not official event promotional artwork.
// Unsplash license: https://unsplash.com/license . Retain provenance off-card.
export const stockPhoto = (id:string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=85`;
export const LISTING_MEDIA: Record<string,string> = {
 'midnight-observatory':'1462331940025-496dfbfc7564','last-platform':'1474487548417-781cb71495f3',
 'letters-from-home':'1455390582262-044cdead277a','weekend-mixup':'1529156069898-49953e39b3ac',
 'paper-moon':'1513364776144-60967b0f800f','wild-river':'1432405972618-c60b0225b8f9',
 'skyline-sessions':'1516280440614-37939bbacd81','laugh-lines':'1516450360452-9312f5e86fc7',
 'curtain-call':'1503095396549-807759245b35','colour-stories':'1577083552431-6e5fd01aa342',
 'rhythm-festival':'1470229722913-7c0e2dbbafd3','jazz-after-dark':'1415201364774-f6f0bb35f28f',
 'city-cricket':'1540747913346-19e32dc3e97e','city-football':'1574629810360-7efbbe195018',
 'shuttle-open':'1622279457486-62dcc4a431d6','basketball-evening':'1546519638-68e109498ffc',
 'table-tennis':'1534158914592-062992fbe900','running-weekend':'1461896836934-ffe607ba8211',
 'pottery-workshop':'1493106641515-6b5631de4bb9','vr-discovery':'1593508512255-86ab42a8e620',
 'climbing-studio':'1522163182402-834f871fd851','family-science':'1532094349884-543bc11b234d',
 'photo-walk':'1452587925148-ce544e77e70d','guitar-circle':'1510915361894-db8b60106cb1',
};
export const EVENT_MEDIA: Record<string,string> = {
 'delhi-sport':'1593341646782-e0b495cff86d','mumbai-sport':'1431324155629-1a6deb1dec8d','bengaluru-sport':'1519861531473-9200262188bf',
 'delhi-comedy':'1492684223066-81342ee5ff30','mumbai-comedy':'1598387993441-a364f854c3e1','bengaluru-comedy':'1515169067868-5387ec356754',
 'delhi-workshop':'1460661419201-fd4cecdf8a8b','mumbai-workshop':'1513364776144-60967b0f800f','bengaluru-workshop':'1455390582262-044cdead277a',
};
export const PREVIOUS_EVENT_MEDIA: Record<string,string> = {
 'mumbai-comedy':stockPhoto('1516450360452-9312f5e86fc7'),
 'bengaluru-comedy':stockPhoto('1503095396549-807759245b35'),
};
