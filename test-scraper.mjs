// Test direct de l'URL générée par le package
const url = 'https://sslecal2.investing.com/?importance=1,2,3&calType=day&lang=1&timeZone=55';

const res = await fetch(url, {
  headers: {
    'Accept': '*/*',
    'Connection': 'keep-alive',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'text/html; charset=UTF-8',
    'Host': 'sslecal2.investing.com',
  }
});

const html = await res.text();
console.log('Status:', res.status);
console.log('Content-Length:', html.length);
console.log('ecEventsTable présent:', html.includes('ecEventsTable'));
console.log('eventRowId présent:', html.includes('eventRowId'));
console.log('Début HTML:', html.slice(0, 300));
