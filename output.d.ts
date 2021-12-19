export type Maybe<T> = T | null | undefined;

export type Tweet = {
  id: Maybe<ID>;
  body: Maybe<String>;
  date: Maybe<Date>;
  Author: Maybe<User>;
  Stats: Maybe<Stat>;
};

export type ID = string;

export type String = string;

export type Date = any;

export type User = {
  last_name: Maybe<String>;
  first_name: Maybe<String>;
};

export type Stat = {
  views: Maybe<Int>;
  likes: Maybe<Int>;
  retweets: Maybe<Int>;
  user: Maybe<User>;
  test: Maybe<Test>;
};

export type Int = number;

export enum Test {
  A,
  B,
  C,
};
