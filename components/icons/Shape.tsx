export default function Shape(props: JSX.IntrinsicElements["svg"]) {
  return (
    <svg
      {...props}
      width="1440"
      height="1024"
      viewBox="0 0 1440 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clip-path="url(#clip0_1_6)">
        <path
          d="M338 554.5C88.5 554.5 64 844.5 -97 844.5V1180.5H1536.5V179H1474C1474 510.5 1215 643 1015.5 643C816 643 587.5 554.5 338 554.5Z"
          fill="currentColor"
          stroke="black"
          strokeWidth="5"
        />
      </g>
      <defs>
        <linearGradient
          id="paint0_linear_1_6"
          x1="386"
          y1="755.5"
          x2="498.5"
          y2="1703"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
        <clipPath id="clip0_1_6">
          <rect width="1440" height={props.height || "1024"} fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
