import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { clearDiscount, redeemDiscount } from "../flow";

export const useHostDiscount = () => {
  const session = useSuperwallSession();
  const queue = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(
    () =>
      session.on("redeem_discount", ({ code }) => {
        const trimmed = code.trim();
        queue.current = queue.current.then(async () => {
          if (trimmed === "") clearDiscount(session);
          else await redeemDiscount(session, trimmed);
        });
      }),
    [session],
  );
};
