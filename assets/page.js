// ${window.location}
(async () => {
  const likeCount = document.querySelector("#like-count");
  await fetch(`${window.location.origin}/authenticate`, { method: "POST" });

  const resp = await (
    await fetch(`${window.location.origin}/get_likes`, {
      method: "POST",
      body: JSON.stringify({
        url: `https://mitchellhynes.com${window.location.pathname}`,
      }),
    })
  ).json();
  likeCount.textContent = `${parseInt(resp.number)}`;

  const likeButton = document.querySelector("#like-button");

  likeButton.addEventListener("change", async (e) => {
    await fetch(`${window.location.origin}/like_page`, {
      method: "POST",
      body: JSON.stringify({
        url: `https://mitchellhynes.com${window.location.pathname}`,
      }),
    });
    likeCount.textContent = `${parseInt(likeCount.textContent) + 1}`;
    e.target.disabled = true;
  });
})();
