This is command-line tool with a set of utilities for Nostr sites and npub.pro.

For now it's very early and this repo is just a bunch of useful commands all 
dropped into index.js. 

Most useful thing you might wish to do is publishing a Ghost theme. Try this:

```
node index.js publish_theme path/to/theme
```

It will ask you for NIP-46 auth, so make sure to have an nsecbunker, Amber or nsec.app.