/* eslint-disable comma-style, operator-linebreak, space-unary-ops, no-multi-spaces, key-spacing, indent */
'use strict'

function round (n) {
  return Math.round(n * 10) / 10
}

function notmetadata (k) {
  return k !== 'metadata'
}

function copyValues (o) {
  function copy (acc, k) {
    acc[k] = o[k]
    return acc
  }
  return Object.keys(o)
    .filter(notmetadata)
    .reduce(copy, {})
}

function getStartingPot (o, playerCount) {
  const totalAnte = (o.ante || 0) * playerCount
  return  (o.sb || 0) + (o.bb || 0) + totalAnte
}

function postFlopOrderFromPreflopOrder (n, playerCount) {
  // headsup just reverses the order
  if (playerCount === 2) return n === 0 ? 1 : 0

  if (n === (playerCount - 1)) return 1 // BB
  if (n === (playerCount - 2)) return 0 // SB
  return n + 2
}

function strategicPositionFromPostFlopOrder (n, playerCount) {
  // n is position in which player 'would have' acted on flop and after
  // 'would have' because he may have folded preflop ;)

  // headsup
  if (playerCount === 2) {
    if (n === 0) return 'bb'
    if (n === 1) return 'sb'
  }

  // no headsup

  // blinds
  if (n === 0) return 'sb'
  if (n === 1) return 'bb'

  // othersk
  switch (playerCount - n) {
    case 1: return 'bu'
    case 2: return 'co'
    case 3: return 'lt'
    case 4:
    case 5:
      return 'mi'
    case 6:
    case 7:
    case 8:
      return 'ea'
  }
}

function byPostFlopOrder (p1, p2) {
  return p1.postflopOrder - p2.postflopOrder
}

function sortPlayersByPostFlopOrder (players) {
  function appendPlayer (acc, k) {
    const p = players[k]
    p.name = k
    acc.push(p)
    return acc
  }
  return Object.keys(players)
    .reduce(appendPlayer, [])
    .sort(byPostFlopOrder)
}

function playerInvested (preflop) {
  for (let i = 0; i < preflop.length; i++) {
    const action = preflop[i].type
    if (action === 'bet' || action === 'call' || action === 'raise') return true
  }
  return false
}

function addInvestedInfo (players) {
  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    player.invested = player.sb || player.bb || playerInvested(player.preflop)
  }
}

function updateChips (prev, current, investeds, players, hand) {
  Object.keys(players)
    .forEach(updatePlayerChips, { prev: prev, current: current })

  function updatePlayerChips (k) {
    const p = players[k]
    let chips = p[this.prev] - (investeds[k] || 0)
    if (this.prev === 'chipsPreflop') {
      if (p.bb) chips += hand.info.bb
      if (p.sb) chips += hand.info.sb
    }
    p.chipsAfter = p[this.current] = chips
  }
}

module.exports = function analyzeHoldem (hand) {
  let pot = 0
  let currentBet = hand.info.bb

  const playerCount = hand.seats.length
  const startingPot = getStartingPot(hand.info, playerCount)

  const players = {}
  const analyzed = {
      info    : copyValues(hand.info)
    , table   : copyValues(hand.table)
    , board   : copyValues(hand.board)
  }
  analyzed.info.players = playerCount

  for (let i = 0; i < playerCount; i++) {
    const s = hand.seats[i]
    const player = {
        seatno        : s.seatno
      , chips         : s.chips
      , chipsPreflop  : s.chips
      , chipsFlop     : NaN
      , chipsTurn     : NaN
      , chipsRiver    : NaN
      , chipsShowdown : NaN
      , chipsAfter    : NaN
      , m             : Math.round(s.chips / startingPot)
      , preflop       : []
      , flop          : []
      , turn          : []
      , river         : []
      , showdown      : []
    }
    if (hand.table.button === s.seatno) player.button = true
    if (hand.hero === s.player) {
      player.hero = true
      if (hand.holecards) {
        player.cards = { card1: hand.holecards.card1, card2: hand.holecards.card2 }
      }
    }
    players[s.player] = player
  }
  analyzed.players = players

  for (let i = 0; i < hand.posts.length; i++) {
    const p = hand.posts[i]
    const player = players[p.player]
    pot += p.amount
    player.chipsAfter = player.chipsPreflop -= p.amount

    if (p.type === 'sb') player.sb = true
    if (p.type === 'bb') player.bb = true
  }

  function analyzeAction (p, invested) {
    const startingPot = pot
    let cost = 0
    const action = {
        type: p.type
    }
    if (p.type === 'raise') {
      action.ratio = round(p.raiseTo / currentBet)
      action.allin = !!p.allin
      action.amount = p.raiseTo - invested
      currentBet = p.raiseTo
      pot += currentBet
      cost = action.amount
    } else if (p.type === 'bet') {
      action.ratio = round(p.amount / pot)
      action.allin = !!p.allin
      action.amount = p.amount
      currentBet = p.amount
      pot += currentBet
      cost = action.amount
    } else if (p.type === 'call') {
      action.ratio = round(p.amount / pot)
      action.allin = !!p.allin
      action.amount = p.amount
      pot += p.amount
      cost = action.amount
    }
    action.pot = startingPot
    return { action: action, cost: cost || 0 }
  }

  let investeds = {}

  function startPreflopCost (p) {
    if (p.bb) return hand.info.bb
    if (p.sb) return hand.info.sb
    return 0
  }

  for (let i = 0; i < hand.preflop.length; i++) {
    const p = hand.preflop[i]
    const player = players[p.player]
    const invested = investeds[p.player] || startPreflopCost(player)
    const info = analyzeAction(p, invested)
    player.preflop.push(info.action)
    if (!player.hasOwnProperty('preflopOrder')) {
      player.preflopOrder = i
      player.postflopOrder = postFlopOrderFromPreflopOrder(i, playerCount)
      player.pos = strategicPositionFromPostFlopOrder(player.postflopOrder, playerCount)
    }
    investeds[p.player] = invested + info.cost
  }
  updateChips('chipsPreflop', 'chipsFlop', investeds, players, hand)

  investeds = {}
  for (let i = 0; i < hand.flop.length; i++) {
    const p = hand.flop[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    player.flop.push(info.action)
    investeds[p.player] = invested + info.cost
  }
  updateChips('chipsFlop', 'chipsTurn', investeds, players, hand)

  investeds = {}
  for (let i = 0; i < hand.turn.length; i++) {
    const p = hand.turn[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    player.turn.push(info.action)
    investeds[p.player] = invested + info.cost
  }
  updateChips('chipsTurn', 'chipsRiver', investeds, players, hand)

  investeds = {}
  for (let i = 0; i < hand.river.length; i++) {
    const p = hand.river[i]
    const player = players[p.player]
    const invested = investeds[p.player] || 0
    const info = analyzeAction(p, invested)
    player.river.push(info.action)
    investeds[p.player] = invested + info.cost
  }
  updateChips('chipsRiver', 'chipsShowdown', investeds, players, hand)

  // first we aggregate all collections and then condense into one action
  let collecteds = {}
  for (let i = 0; i < hand.showdown.length; i++) {
    const p = hand.showdown[i]
    const player = players[p.player]
    if (p.type === 'show' || p.type === 'muck') {
      player.cards = { card1: p.card1, card2: p.card2 }
    } else if (p.type === 'collect') {
      collecteds[p.player] = (collecteds[p.player] || 0) + p.amount
    }
  }

  Object.keys(collecteds).forEach(processCollecteds)
  function processCollecteds (k) {
    const player = players[k]
    const amount = collecteds[k]
    const ratio = round(amount / pot)
    const action = {
        type   : 'collect'
      , ratio  : ratio
      , winall : ratio === 1
      , amount : amount
    }
    player.showdown.push(action)
    player.chipsAfter += amount
  }

  analyzed.players = sortPlayersByPostFlopOrder(players)
  addInvestedInfo(analyzed.players)
  return analyzed
}