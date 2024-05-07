import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  PlaidLinkOnSuccess,
  PlaidLinkOptions,
  usePlaidLink,
} from "react-plaid-link";
import { useRouter } from "next/navigation";
import {
  createLinkToken,
  exchangePublicToken,
} from "@/lib/actions/user.actions";
import Image from "next/image";
import { cn } from "@/lib/utils";

const PlaidLink = ({ user, variant }: PlaidLinkProps) => {
  const router = useRouter();

  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const getLinkToken = async () => {
      const data = await createLinkToken(user);
      setToken(data?.linkToken);
    };

    getLinkToken();
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (public_token: string) => {
      await exchangePublicToken({
        publicToken: public_token,
        user,
      });
      router.push("/");
    },
    [user]
  );

  const config: PlaidLinkOptions = {
    token,
    onSuccess,
  };

  const { open, ready } = usePlaidLink(config);

  return (
    <>
      {variant === "primary" ? (
        <Button
          onClick={() => open()}
          disabled={!ready}
          className="plaidlink-primary"
        >
          <p className={cn("sidebar-label")}>Connect Bank</p>
        </Button>
      ) : variant === "ghost" ? (
        <Button
          onClick={() => open()}
          className="plaidlink-ghost"
          variant="ghost"
        >
          <Image
            src={"/icons/connect-bank.svg"}
            alt="connect bank"
            fill
          />
          <p
            className={cn(
              "sidebar-label",
              "text-[16px] font-semibold text-black-2"
            )}
          >
            Connect Bank
          </p>
        </Button>
      ) : (
        <Button onClick={() => open()} className="plaidlink-default">
          <Image
            src={"/icons/connect-bank.svg"}
            alt="connect bank"
            width={24}
            height={24}
          />
          <p
            className={cn(
              "text-[16px] font-semibold text-black-2 xl:block md:hidden block"
            )}
          >
            Connect Bank
          </p>
        </Button>
      )}
    </>
  );
};

export default PlaidLink;
