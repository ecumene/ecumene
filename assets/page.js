const getLikeCount = async () => {
  const likeCount = document.querySelector("#like-count");
  const response = await fetch(`${window.location.origin}/likes`);
  const json = await response.json();
  if (response.ok) {
    likeCount.textContent = `${parseInt(json.number)}`;
  } else {
    likeCount.textContent = "???";
    const likeButton = document.querySelector("#like-button");
    likeButton.disabled = true;
  }
  return json;
};

// ${window.location}
(async () => {
  const { has_liked: hasLiked } = await getLikeCount();
  const likeButton = document.querySelector("#like-button");
  likeButton.checked = hasLiked;

  likeButton.addEventListener("change", async (e) => {
    let response = await fetch(`${window.location.origin}/likes`, {
      method: e.target.checked ? "POST" : "DELETE",
    });

    if (response.ok) {
      const { has_liked: hasLiked } = await getLikeCount();
      e.target.checked = hasLiked;
      likeButton.checked = hasLiked;
    }
  });
})();
