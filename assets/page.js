// ${window.location}
(async () => {
  await fetch(`${window.location.origin}/authenticate`, { method: "POST" });

  console.log(
    await fetch(`${window.location.origin}/get_likes`, {
      method: "POST",
      body: JSON.stringify({
        url: `https://mitchellhynes.com${window.location.pathname}`,
      }),
    })
  );
  // const likes = await fetch(`${window.location.origin}/get_likes`);
  // const likeButton = document.querySelector("#like-button");

  // likeButton.addEventListener("click", async () => {
  // });
})();
