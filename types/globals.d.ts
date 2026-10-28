interface DoodlerFriend {
  userId: number;
  name: string;
  country: string;
  hash: string;
}

// set by extension/content/friends.js, read by content.js in the same isolated world
declare function doodlerFriends(): { friends: DoodlerFriend[]; current: number | null };
