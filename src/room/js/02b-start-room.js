/* =========================================================================
   START — whatever start screen the build uses (see 02a in the private build)
   ends up here once it knows who is playing. Carries on into a
   deck handed over from the deckbuilder or a direct board link if there is one,
   else shows the setup screen.
   ========================================================================= */
function startRoom(player){   // player = { name, label }  (label: how "Playing as" reads)
  state.playerName = player.name;
  document.getElementById('setupSignedInAs').textContent = player.label;
  if(roomHandoff){ startFromHandoff(roomHandoff); return; } // sent here from the deckbuilder: skip the setup screen
  if(boardLinkGameId){ startFromBoardLink(boardLinkGameId); return; } // a direct "open a room on this game's board" link
  document.getElementById('setup-screen').classList.remove('hidden');
}
