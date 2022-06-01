const getLikeCount = async () => {
  const likeCount = document.querySelector("#like-count");
  const resp = await (await fetch(`${window.location.origin}/likes`)).json();
  likeCount.textContent = `${parseInt(resp.number)}`;
  return resp;
};

// ${window.location}
(async () => {
  const { has_liked } = await getLikeCount();
  const likeButton = document.querySelector("#like-button");
  likeButton.checked = has_liked;

  likeButton.addEventListener("change", async (e) => {
    let response = await fetch(`${window.location.origin}/likes`, {
      method: e.target.checked ? "POST" : "DELETE",
    });

    if (response.ok) {
      const { has_liked } = await getLikeCount();
      e.target.checked = has_liked;
      likeButton.checked = has_liked;
    }
  });
})();
