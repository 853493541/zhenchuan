#!/bin/bash
set -euo pipefail

BASE="http://localhost:5000"

COOKIE_P0="cookies_catcake.txt"
COOKIE_P1="cookies_guest.txt"

P0_ID="697076e1877c4c3465dcea36"
P1_ID="6970ac81f900736d8df15819"

echo "Creating game..."
CREATE=$(curl -s -X POST "$BASE/game/create" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_P0" \
  -d "{\"opponentUserId\":\"$P1_ID\"}")

echo "$CREATE"

GAME_ID=$(echo "$CREATE" | sed -n 's/.*"_id":"\([^"]*\)".*/\1/p')

if [ -z "$GAME_ID" ]; then
  echo "FAILED TO CREATE GAME"
  exit 1
fi

echo
echo "GAME $GAME_ID"
echo "==============================="

# ---------------------------------------------------------
# TURN 0
# ---------------------------------------------------------
echo
echo "=== TURN 0 : FETCH STATE ==="
STATE=$(curl -s "$BASE/game/$GAME_ID" -b "$COOKIE_P0")
echo "$STATE"
echo

# ---- extract P0 hand safely ----
P0_HAND=$(echo "$STATE" \
  | sed -n "s/.*\"userId\":\"$P0_ID\".*\"hand\":\[\([^]]*\)\].*/\1/p")

P0_CARD_INSTANCE=$(echo "$P0_HAND" \
  | sed -n 's/.*"instanceId":"\([^"]*\)".*/\1/p' \
  | head -n 1)

if [ -z "$P0_CARD_INSTANCE" ]; then
  echo "FAILED TO EXTRACT P0 HAND CARD"
  exit 1
fi

echo "P0 plays card instance: $P0_CARD_INSTANCE"

echo
echo "=== TURN 0 : P0 PLAYS FIRST CARD ==="
curl -s -X POST "$BASE/game/play" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_P0" \
  -d "{
    \"gameId\":\"$GAME_ID\",
    \"cardInstanceId\":\"$P0_CARD_INSTANCE\",
    \"targetUserId\":\"$P1_ID\"
  }"
echo

echo
echo "=== TURN 0 : P0 PASSES ==="
curl -s -X POST "$BASE/game/pass" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_P0" \
  -d "{\"gameId\":\"$GAME_ID\"}"
echo

# ---------------------------------------------------------
# TURN 1
# ---------------------------------------------------------
echo
echo "=== TURN 1 : FETCH STATE ==="
STATE=$(curl -s "$BASE/game/$GAME_ID" -b "$COOKIE_P1")
echo "$STATE"
echo

# ---- extract P1 hand safely ----
P1_HAND=$(echo "$STATE" \
  | sed -n "s/.*\"userId\":\"$P1_ID\".*\"hand\":\[\([^]]*\)\].*/\1/p")

P1_CARD_INSTANCE=$(echo "$P1_HAND" \
  | sed -n 's/.*"instanceId":"\([^"]*\)".*/\1/p' \
  | head -n 1)

if [ -z "$P1_CARD_INSTANCE" ]; then
  echo "FAILED TO EXTRACT P1 HAND CARD"
  exit 1
fi

echo "P1 plays card instance: $P1_CARD_INSTANCE"

echo
echo "=== TURN 1 : P1 PLAYS FIRST CARD ==="
curl -s -X POST "$BASE/game/play" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_P1" \
  -d "{
    \"gameId\":\"$GAME_ID\",
    \"cardInstanceId\":\"$P1_CARD_INSTANCE\",
    \"targetUserId\":\"$P0_ID\"
  }"
echo

echo
echo "=== TURN 1 : P1 PASSES ==="
curl -s -X POST "$BASE/game/pass" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_P1" \
  -d "{\"gameId\":\"$GAME_ID\"}"
echo

# ---------------------------------------------------------
# FINAL
# ---------------------------------------------------------
echo
echo "=== TURN 2 : FINAL STATE ==="
curl -s "$BASE/game/$GAME_ID" -b "$COOKIE_P0"
echo

echo "==============================="
echo "DONE"
