// eslint-disable-next-line no-unused-vars -- CloudFront invokes this global entry point.
function handler(event) {
  var request = event.request;
  var route = normalizeRoute(request.uri);
  var destination;

  if (route === "/" || route === "/blog" || route === "/devlog") {
    destination = "https://mitchellhynes.com/blog";
  } else if (route === "/about") {
    destination = "https://mitchellhynes.com/about";
  } else if (route === "/rss.xml" || route === "/sitemap-index.xml" || route === "/sitemap-0.xml") {
    destination = "https://mitchellhynes.com" + route;
  } else if (route === "/blog/using-mdx") {
    // This post was public on the old static site despite being marked as a draft.
    destination = "https://mitchellhynes.com/blog";
  } else {
    var postMatch = route.match(/^\/(?:blog|devlog)\/([^/]+)$/);
    if (postMatch && postMatch[1].indexOf(".") === -1) {
      destination = "https://mitchellhynes.com/blog/" + postMatch[1];
    }
  }

  if (!destination) {
    // Keep legacy media, generated social images, and other assets on the old origin.
    return request;
  }

  destination = appendQueryString(destination, request.querystring);

  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: {
      location: { value: destination },
      "cache-control": { value: "public, max-age=3600" },
    },
  };
}

function appendQueryString(destination, querystring) {
  var parts = [];

  Object.keys(querystring || {}).forEach(function (name) {
    var parameter = querystring[name];
    var values = parameter.multiValue || [parameter];

    values.forEach(function (entry) {
      var key = encodeURIComponent(name);
      var value = entry.value ? "=" + encodeURIComponent(entry.value) : "";
      parts.push(key + value);
    });
  });

  return parts.length ? destination + "?" + parts.join("&") : destination;
}

function normalizeRoute(uri) {
  var route = uri || "/";

  if (route === "/index.html") {
    return "/";
  }

  if (route.endsWith("/index.html")) {
    route = route.slice(0, -11);
  }

  if (route.length > 1 && route.endsWith("/")) {
    route = route.slice(0, -1);
  }

  return route;
}
