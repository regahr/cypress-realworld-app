import React from "react";
import { styled } from "@mui/material/styles";
import { get } from "lodash/fp";
import { useTheme, useMediaQuery, Divider } from "@mui/material";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import InfiniteLoader from "react-window-infinite-loader";

import TransactionItem from "./TransactionItem";
import { TransactionResponseItem, TransactionPagination } from "../models";

const TransactionListContainer = styled("div")(() => ({
  width: "100%",
  minHeight: "80vh",
  display: "flex",
  overflow: "auto",
  flexDirection: "column",
}));

export interface TransactionListProps {
  transactions: TransactionResponseItem[];
  loadNextPage: Function;
  pagination: TransactionPagination;
}

const TransactionInfiniteList: React.FC<TransactionListProps> = ({
  transactions,
  loadNextPage,
  pagination,
}) => {
  const theme = useTheme();
  const isXsBreakpoint = useMediaQuery(theme.breakpoints.down("sm"));
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const itemCount = pagination.hasNextPages ? transactions.length + 1 : transactions.length;

  const loadMoreItems = () => {
    return new Promise((resolve) => {
      return resolve(pagination.hasNextPages && loadNextPage(pagination.page + 1));
    });
  };

  const isItemLoaded = (index: number) => !pagination.hasNextPages || index < transactions.length;

  const removePx = (str: string) => +str.slice(0, str.length - 2);

  const Row = ({ index, style }: ListChildComponentProps) => {
    const transaction = get(index, transactions);

    if (index >= transactions.length) {
      return null;
    }

    return (
      <div style={style}>
        <TransactionItem transaction={transaction} />
        <Divider variant={isMobile ? "fullWidth" : "inset"} />
      </div>
    );
  };

  return (
    <InfiniteLoader
      isItemLoaded={isItemLoaded}
      loadMoreItems={loadMoreItems}
      itemCount={itemCount}
      threshold={2}
    >
      {({ onItemsRendered, ref }) => (
        <TransactionListContainer data-test="transaction-list">
          <FixedSizeList
            itemCount={itemCount}
            ref={ref}
            onItemsRendered={onItemsRendered}
            height={isXsBreakpoint ? removePx(theme.spacing(74)) : removePx(theme.spacing(88))}
            width={isXsBreakpoint ? removePx(theme.spacing(38)) : removePx(theme.spacing(90))}
            itemSize={isXsBreakpoint ? removePx(theme.spacing(28)) : removePx(theme.spacing(16))}
          >
            {Row}
          </FixedSizeList>
        </TransactionListContainer>
      )}
    </InfiniteLoader>
  );
};

export default TransactionInfiniteList;
