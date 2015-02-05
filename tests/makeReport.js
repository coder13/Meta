
/* jshint asi: true */
var fs = require("fs");
var argv = require("optimist")
    .usage("Generate a Lift Security Report from a markdown file.\nUsage: $0")
    .demand("f")
    .alias("f", "file")
    .default("f", process.cwd() + '/findings.md')
    .describe("f", "Source Markdown File")
    .demand("s")
    .alias("s", "summary")
    .default("s", process.cwd() + '/summary.md')
    .describe("s", "Summary markdown file")
    // .demand("c")
    // .alias("c", "client")
    // .default("c", process.cwd().split('/').slice(-1))
    // .describe("c", "Client name")
    .demand("m")
    .alias("m", "month")
    .default("m", ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][parseInt(new Date().getMonth())])
    .describe("m", "Report Month ex October")
    .alias("y", "year")
    .default("y", (new Date().getFullYear()))
    .describe("y", "Report Year ex 1964")
    .boolean("h")
    .alias("h", "html")
    .default("h", false)
    .describe("h", "Save the intermediate HTML to a file")
    .argv;

var Readable = require('stream').Readable
var exists = fs.existsSync;
var marked = require("marked");
var _ = require("underscore");
var util = require("util");

var renderer = new marked.Renderer();
renderer.heading = function (text, level) {
    return "<h" + level + ">" + text + "</h" + level + ">";
}

renderer.image = function (href, title, text) {
    return '<figure class="outlined"><img src="' + href + '" alt="' + text + '"></figure>';
}

var summary = marked(fs.readFileSync(argv.summary).toString(), {
    renderer: renderer,
    sanitize: true,
    gfm: true
});

var reportObject = {
    companyname: String(argv.client),
    month: argv.month,
    year: argv.year,
    summary: summary,
    toc: "",
    findings: []
};


fs.readFile(argv.file, function (err, data) {
    if (err) {
        throw err;
    }
    var myItems = data.toString().split('')
    myItems.unshift('\n');
    myItems = myItems.join('').split(/\n#\s*(?=[^#])/); // Split on a carriage return and a line that starts with a single #

    for (var i = 0; i < myItems.length; i++) {
        var tmpFinding = parseFinding("#" + myItems[i]);
        if (tmpFinding) {
            tmpFinding.sortOrder = i + 1;
            reportObject.findings.push(tmpFinding);
        }
    }
    writeReport(reportObject);
});

function getClientNameFromFolder () {
    var myFolders = process.cwd().split('/');
    var myNotNames = ["report","working",'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var noName = true;
    var clientName = "Client";

    while (noName){

        noName = false;

    }
    return clientName;
}

function makePdf(html, outfile) {
    var spawn = require('child_process').spawn;
    var wkBinary = __dirname + '/bin/wkhtmltopdf';
    if (!exists(wkBinary)) {
        throw new Error('Could not find wkhtmltopdf at ' + wkBinary + '. Please place the binary there and try again.');
    } else {
        if (Object.prototype.toString.call(html) === '[object String]') {
            html = html.split('\n');
        } else if (Object.prototype.toString.call(html) !== '[object Array]') {
            throw new Error("Unknown error. Unable to parse html argument to makePdf");
        }

        var s = new Readable();
        html.forEach(function (line) {
            s.push(line + '\n');
        })
        s.push(null)
        var wkpdf = spawn(wkBinary, ['--margin-bottom', '.75in', '--margin-left', '.75in', '--margin-right', '.75in', '--margin-top', '.75in', '--print-media-type', '-', outfile]);
        wkpdf.stdout.pipe(process.stdout);
        s.pipe(wkpdf.stdin);
        console.log('Generating PDF... Please Wait.');
        wkpdf.on('close', function () {
            console.log('Saved to: ' + outfile);
        });
    }
}


function parseFinding(findingMarkdown) {
    var myFinding = {},
        myRE;

    var myFindingHTML = marked(findingMarkdown, {
        renderer: renderer,
        sanitize: true,
        gfm: true
    }) + "<h2>";

    if (!myFindingHTML.match(/<h1>.*<\/h1>/i)) return false; // This is a broken finding, or worthless data
    if (!myFindingHTML.match(/<h2>.*<\/h2>/i) && !myFindingHTML.match(/<h1>Coverage[:]?<\/h1>/i)) return false; // This is a broken finding, or worthless data

    myFinding.title = myFindingHTML.match(/<h1>(.*)<\/h1>/i)[1];

    myFindingHTML = myFindingHTML.replace(/<h1>(.*)<\/h1>/i, "");


    myRE = /executive summary/i;
    // console.log(util.inspect(myFindingHTML.match(myRE), false, null, true));
    if (myFinding.title.match(myRE) !== null) {
        reportObject.summary = myFindingHTML
        return;
    }

    myRE = /<h2>sever.*?:\s*(.*?)<\/h2>/i;
    // console.log(util.inspect(myFindingHTML.match(myRE), false, null, true));
    if (myFindingHTML.match(myRE) !== null) {
        myFinding.severity = myFindingHTML.match(myRE)[1];
        myFindingHTML = myFindingHTML.replace(myRE, "");
    }

    myRE = /<h2>example.*?<\/h2>([\s\S]*?)(?=<h2>)/i;
    // console.log(util.inspect(myFindingHTML.match(myRE), false, null, true));
    if (myFindingHTML.match(myRE) !== null) {
        myFinding.example = myFindingHTML.match(myRE)[1];
        myFindingHTML = myFindingHTML.replace(myRE, "");
    }

    myRE = /<h2>recom.*?<\/h2>([\s\S]*?)(?=<h2>)/i;
    // console.log(util.inspect(myFindingHTML.match(myRE), false, null, true));
    if (myFindingHTML.match(myRE) !== null) {
        myFinding.recommendations = myFindingHTML.match(myRE)[1];
        myFindingHTML = myFindingHTML.replace(myRE, "");
    }

    myRE = /<h2>refer.*?<\/h2>([\s\S]*?)(?=<h2>)/i;
    // console.log(util.inspect(myFindingHTML.match(myRE), false, null, true));
    if (myFindingHTML.match(myRE) !== null) {
        myFinding.references = myFindingHTML.match(myRE)[1];
        myFindingHTML = myFindingHTML.replace(myRE, "");
    }

    myFinding.content = myFindingHTML.replace(/<h2>$/, "");

    return myFinding;
}

function writeReport(myReportObject) {
    var myFindingText = "",
        myTOC = [],
        myOutData = []

    myReportObject.findings = _.sortBy(myReportObject.findings, function (finding) {
        var sevArray = ["Critical", "High", "Medium", "Low", "Informational"];
        // If it's not known stick it at the bottom.
        var i = sevArray.indexOf(finding.severity);
        if (i === -1) {
            i = 500;
        }
        return i + "-" + finding.sortOrder + "-" + finding.title;
    })

    for (var i = 0; i < myReportObject.findings.length; i++) {
        if (myReportObject.findings[i].title) {

            myFindingText = "<div class='finding'>";
            myFindingText += "<h1><a name='finding" + myReportObject.findings[i].sortOrder + "'></a>" + myReportObject.findings[i].title + "</h1>";

            myTOC.push({
                title: myReportObject.findings[i].title,
                sortOrder: myReportObject.findings[i].sortOrder,
                severity: myReportObject.findings[i].severity
            });


            if (myReportObject.findings[i].severity) {
                myFindingText += "\n<h2>Severity: " + myReportObject.findings[i].severity + "</h2>\n";
            }

            myFindingText += myReportObject.findings[i].content;


            if (myReportObject.findings[i].example) {
                myFindingText += "\n<h2>Example:</h2>\n" + myReportObject.findings[i].example + "";
            }

            if (myReportObject.findings[i].recommendations) {
                myFindingText += "\n<h2>Recommendations:</h2>\n" + myReportObject.findings[i].recommendations + "";
            }

            if (myReportObject.findings[i].references) {
                myFindingText += "\n<h2>References:</h2>\n" + myReportObject.findings[i].references + "";
            }

            myFindingText += "</div>";
            myOutData.push(myFindingText);

        }
    }

    htmlTOC = buildTOC(myTOC);

    fs.readFile(__dirname + "/data/base.html", function (err, data) {

        if (err) {
            throw err;
        }

        myHTMLOut = data.toString();

        myHTMLOut = myHTMLOut.replace("{{findings}}", myOutData.join(""));
        myHTMLOut = myHTMLOut.replace("{{toc}}", htmlTOC);
        myHTMLOut = myHTMLOut.replace("{{companyname}}", reportObject.companyname);
        myHTMLOut = myHTMLOut.replace("{{month}}", reportObject.month);
        myHTMLOut = myHTMLOut.replace("{{year}}", reportObject.year);
        myHTMLOut = myHTMLOut.replace("{{summary}}", reportObject.summary);

        pdfOutFile = argv.file.split('/');
        pdfOutFile.pop();

        if (argv.h) {
            var myFname = pdfOutFile.join('/') + '/lift_Security_' + reportObject.companyname.replace(/\s/g, '') + '_Security_Assessment_' + reportObject.month + reportObject.year + 'V1.0.html'
            console.log("Writing HTML out...")
            fs.writeFile(myFname,myHTMLOut,{"flag":"w"});
        };

        pdfOutFile = pdfOutFile.join('/') + '/lift_Security_' + reportObject.companyname.replace(/\s/g, '') + '_Security_Assessment_' + reportObject.month + reportObject.year + 'V1.0.pdf';
        makePdf(myHTMLOut, pdfOutFile);

    });
}

function buildTOC(myTOC) {
    var myTOCObj = {
        "Critical": [],
        "High": [],
        "Medium": [],
        "Low": [],
        "Informational": [],
    };
    var standAlones = [];
    myHTMLOut = "";


    for (var i = 0; i < myTOC.length; i++) {
        if (typeof myTOC[i].severity === 'undefined') {
            standAlones.push("\n<h3>" + myTOC[i].title + "</h3>");
            continue;
        }

        if (!myTOCObj[myTOC[i].severity]) myTOCObj[myTOC[i].severity] = [];

        myTOCObj[myTOC[i].severity].push("\n<li><a href='#finding" + myTOC[i].sortOrder + "'>" + myTOC[i].title + "</a></li>")
    }

    _.forEach(myTOCObj, function (el, ind) {
        if (el.length === 0) el.push("\n<li>None</li>");
        myHTMLOut += "\n<h3>" + ind + "</h3><ul>" + el.join("") + "</ul>"
    })
    myHTMLOut += standAlones.join("");

    return myHTMLOut;
}
