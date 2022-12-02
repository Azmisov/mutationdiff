"use_ strict";
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("./package.json"));

// parse git repo
let git = p.repository.url;
git = git.substring(
    git.startsWith("git+") ? 4 : 0,
    git.length - (git.endsWith(".git") ? 4 : 0)
);

const svg = {
    github: `<svg viewBox="0 0 480 384.01144"><path d="m 186.1,264.7 c 0,20.9 -10.9,55.1 -36.7,55.1 -25.8,0 -36.7,-34.2 -36.7,-55.1 0,-20.9 10.9,-55.1 36.7,-55.1 25.8,0 36.7,34.2 36.7,55.1 z M 480,214.2 c 0,31.9 -3.2,65.7 -17.5,95 C 424.6,385.8 320.4,384 245.8,384 170,384 59.6,386.7 20.2,309.2 5.6,280.2 0,246.1 0,214.2 0,172.3 13.9,132.7 41.5,100.6 36.3,84.8 33.8,68.2 33.8,51.8 33.8,30.3 38.7,19.5 48.4,0 c 45.3,0 74.3,9 108.8,36 29,-6.9 58.8,-10 88.7,-10 27,0 54.2,2.9 80.4,9.2 34,-26.7 63,-35.2 107.8,-35.2 9.8,19.5 14.6,30.3 14.6,51.8 0,16.4 -2.6,32.7 -7.7,48.2 27.5,32.4 39,72.3 39,114.2 z m -64.3,50.5 c 0,-43.9 -26.7,-82.6 -73.5,-82.6 -18.9,0 -37,3.4 -56,6 -14.9,2.3 -29.8,3.2 -45.1,3.2 -15.2,0 -30.1,-0.9 -45.1,-3.2 -18.7,-2.6 -37,-6 -56,-6 -46.8,0 -73.5,38.7 -73.5,82.6 0,87.8 80.4,101.3 150.4,101.3 h 48.2 c 70.3,0 150.6,-13.4 150.6,-101.3 z m -82.6,-55.1 c -25.8,0 -36.7,34.2 -36.7,55.1 0,20.9 10.9,55.1 36.7,55.1 25.8,0 36.7,-34.2 36.7,-55.1 0,-20.9 -10.9,-55.1 -36.7,-55.1 z"/></svg>`,
    npm: `<svg viewBox="0 0 576 224"><path d="M 288,128 H 256 V 64 h 32 z M 576,0 V 192 H 288 v 32 H 160 V 192 H 0 V 0 Z M 160,32 H 32 V 160 H 96 V 64 h 32 v 96 h 32 z m 160,0 H 192 v 160 h 64 v -32 h 64 z m 224,0 H 352 v 128 h 64 V 64 h 32 v 96 h 32 V 64 h 32 v 96 h 32 z"/></svg>`
};

module.exports = {
    "source":{
        "include": [p.main],
        "includePattern": ".+\\.mjs$",
    },
    "sourceType": "module",
    "tags": {
        "allowUnknownTags": true,
        "dictionaries": ["jsdoc","closure"]
    },
    "plugins": ["plugins/markdown"],
    "opts": {
        "encoding": "utf8",
        "readme": "./README.md",
        "verbose": true,
        "template": "node_modules/clean-jsdoc-theme",
        "destination": "./docs/",
        "theme_opts": {
            "title": "Overview",
            "include_css": ["./docs_theme/docs.css"],
            "static_dir": ["./docs_theme/static"],
            "base_url": p.homepage,
            "default_theme": "dark",
            "homepageTitle": p.name,
            "meta": [
                {
                    "name": "Author",
                    "content": p.author
                },
                {
                    "name": "Description",
                    "content": p.description
                }
            ],
            "menu": [
                {
                    "title": svg.github,
                    "link": git,
                    "target": "_blank",
                },
                {
                    "title": svg.npm,
                    "link": "https://www.npmjs.com/package/"+p.name,
                    "target": "_blank",
                }
            ]
        }
    },
    "templates": {
        "cleverLinks": false,
    },
    "markdown": {
        "hardwrap": false,
        "idInHeadings": true
    }
};