export default function Card({ cardName }: { cardName: string }) {
  return (
    <svg
      className="lg:w-48 lg:h-60 w-28 h-32"
      viewBox="0 0 169.075 244.640"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
    >
      <use href={`/cards.svg#${cardName}`}></use>
    </svg>
  );
}
