const axios = require("axios");
require("dotenv").config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;

/**
 * Récupère la liste des jeux possédés par un utilisateur
 * @param {string} steamId - ID Steam de l'utilisateur
 * @returns {Promise<Array>} Liste des jeux
 */
async function getUserGames(steamId) {
  try {
    console.log(
      `[DIAGNOSTIC] Récupération des jeux pour l'utilisateur ${steamId}...`
    );

    // Configuration de la requête avec tous les paramètres possibles
    const params = {
      key: STEAM_API_KEY,
      steamid: steamId,
      format: "json",
      include_appinfo: true,
      include_played_free_games: true,
      skip_unvetted_apps: false, // Ne pas ignorer les applications non vérifiées
      include_free_sub: true, // Inclure les jeux gratuits
    };

    console.log(
      "[DIAGNOSTIC] Paramètres de la requête:",
      JSON.stringify(params)
    );

    // Enregistrer l'heure de début pour mesurer le temps de réponse
    const startTime = Date.now();

    const response = await axios.get(
      `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/`,
      { params }
    );

    // Calculer le temps de réponse
    const responseTime = Date.now() - startTime;
    console.log(
      `[DIAGNOSTIC] Temps de réponse de l'API Steam: ${responseTime}ms`
    );

    // Vérifier si la réponse contient la propriété 'games'
    if (!response.data || !response.data.response) {
      console.error(
        "[DIAGNOSTIC] Réponse de l'API Steam invalide, pas d'objet 'response':",
        response.data
      );
      return [];
    }

    // Vérifier si nous avons game_count mais pas de tableau games (cas étrange)
    if (response.data.response.game_count && !response.data.response.games) {
      console.error(
        "[DIAGNOSTIC] Anomalie: game_count présent mais tableau games absent"
      );
      console.log(
        "[DIAGNOSTIC] Contenu de response:",
        JSON.stringify(response.data.response)
      );
      return [];
    }

    const games = response.data.response.games || [];
    const gameCount = response.data.response.game_count || 0;

    console.log(
      `[DIAGNOSTIC] API Steam indique ${gameCount} jeux, ${games.length} jeux récupérés pour l'utilisateur ${steamId}`
    );

    // Vérification de cohérence
    if (gameCount > games.length) {
      console.warn(
        `[DIAGNOSTIC] ATTENTION: Différence entre le nombre de jeux indiqué (${gameCount}) et le nombre réellement récupéré (${games.length})`
      );
      console.warn(
        "[DIAGNOSTIC] Ceci pourrait indiquer une limitation de l'API Steam"
      );
    } else if (gameCount < games.length) {
      console.warn(
        `[DIAGNOSTIC] ATTENTION: Plus de jeux récupérés (${games.length}) que le nombre indiqué (${gameCount}). Comportement inattendu.`
      );
    }

    // Vérifier si le nombre total de jeux paraît anormalement bas
    // Compte le nombre de jeux avec playtime > 0 pour vérifier les jeux réellement joués vs. total
    const playedGames = games.filter(
      (game) => game.playtime_forever > 0
    ).length;
    console.log(
      `[DIAGNOSTIC] Parmi les ${games.length} jeux, ${playedGames} ont été joués (playtime > 0)`
    );

    // Si le nombre de jeux semble anormalement bas pour ce steamID spécifique
    if (games.length < 500 && steamId === "76561198158439485") {
      // Votre steamID
      console.warn(
        `[DIAGNOSTIC] ATTENTION: Seulement ${games.length} jeux récupérés pour l'utilisateur ${steamId} qui devrait en avoir plus de 700`
      );

      // Échantillon des premiers jeux pour analyse
      if (games.length > 0) {
        console.log(
          "[DIAGNOSTIC] Échantillon des 3 premiers jeux:",
          games.slice(0, 3).map((g) => ({
            appid: g.appid,
            name: g.name,
            playtime: g.playtime_forever,
          }))
        );
      }
    }

    return games;
  } catch (error) {
    console.error(
      "[DIAGNOSTIC] Erreur lors de la récupération des jeux:",
      error.message
    );
    console.error("[DIAGNOSTIC] Détails complets de l'erreur:", error);

    // Vérifier si l'erreur est liée à l'API Steam
    if (error.response) {
      console.error(
        "[DIAGNOSTIC] Statut de l'erreur API:",
        error.response.status
      );
      console.error(
        "[DIAGNOSTIC] Données de réponse d'erreur:",
        error.response.data
      );
    }

    throw error;
  }
}

/**
 * Récupère les actualités d'un jeu spécifique
 * @param {string} appId - ID de l'application Steam
 * @param {number} count - Nombre d'actualités à récupérer
 * @param {number} maxLength - Longueur maximale du contenu
 * @param {string} language - Langue des actualités
 * @param {boolean} steamOnly - Filtrer les actualités uniquement hébergées sur Steam
 * @returns {Promise<Array>} Liste des actualités
 */
async function getGameNews(
  appId,
  count = 5,
  maxLength = 300,
  language = "fr",
  steamOnly = true
) {
  try {
    const params = {
      appid: appId,
      count: count,
      maxlength: maxLength,
      format: "json",
      language: language,
    };

    // Ajouter le filtre feeds si steamOnly est activé
    if (steamOnly) {
      params.feeds = "steam_community_announcements,steam_updates";
    }

    const response = await axios.get(
      `http://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/`,
      { params }
    );

    return response.data.appnews.newsitems || [];
  } catch (error) {
    console.error(
      `Erreur lors de la récupération des actualités:`,
      error.message
    );
    throw error;
  }
}

/**
 * Récupère les informations publiques d'un profil Steam
 * @param {string} steamId - ID Steam de l'utilisateur
 * @returns {Promise<Object>} Informations du profil
 */
async function getUserProfile(steamId) {
  try {
    const response = await axios.get(
      `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/`,
      {
        params: {
          key: STEAM_API_KEY,
          steamids: steamId,
          format: "json",
        },
      }
    );

    const players = response.data.response.players || [];
    return players.length > 0 ? players[0] : null;
  } catch (error) {
    console.error("Erreur lors de la récupération du profil:", error.message);
    throw error;
  }
}

/**
 * Fonction de diagnostic pour récupérer le nombre de jeux via la page web de Steam
 * Note: Cette approche utilise web scraping et pourrait ne pas être fiable à long terme
 * @param {string} steamId - ID Steam de l'utilisateur
 * @returns {Promise<Object>} Informations sur la bibliothèque
 */
async function checkSteamProfileGamesCount(steamId) {
  try {
    console.log(
      `[DIAGNOSTIC] Vérification alternative du nombre de jeux pour ${steamId} via le profil web`
    );

    // Déduire le vanityURL ou utiliser directement le steamID
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}/games/?tab=all`;
    console.log(`[DIAGNOSTIC] URL du profil pour vérification: ${profileUrl}`);

    // Faire une requête GET vers la page du profil
    const response = await axios.get(profileUrl);

    // Analyser la réponse pour trouver des indications sur le nombre de jeux
    const pageContent = response.data;

    // Rechercher des motifs dans le HTML qui pourraient indiquer le nombre de jeux
    // Note: ceci est une approche simple et peut ne pas être fiable
    const gameCountMatch =
      pageContent.match(/(\d+) jeux/i) || pageContent.match(/(\d+) games/i);

    if (gameCountMatch && gameCountMatch[1]) {
      const estimatedGamesCount = parseInt(gameCountMatch[1], 10);
      console.log(
        `[DIAGNOSTIC] Estimation du nombre de jeux via le profil web: ${estimatedGamesCount}`
      );
      return {
        estimatedCount: estimatedGamesCount,
        source: "web_profile",
        success: true,
      };
    }

    // Essayer de trouver le script JSON contenant les données des jeux
    const scriptMatch = pageContent.match(/var rgGames\s*=\s*(\[.*?\]);/s);
    if (scriptMatch && scriptMatch[1]) {
      try {
        const gamesData = JSON.parse(scriptMatch[1]);
        console.log(
          `[DIAGNOSTIC] Nombre de jeux trouvés dans les données JavaScript: ${gamesData.length}`
        );
        return {
          estimatedCount: gamesData.length,
          source: "javascript_data",
          success: true,
        };
      } catch (e) {
        console.error(
          `[DIAGNOSTIC] Erreur lors de l'analyse des données JavaScript: ${e.message}`
        );
      }
    }

    console.log(
      `[DIAGNOSTIC] Impossible d'estimer le nombre de jeux via le profil web`
    );
    return {
      success: false,
      error: "No game count found in profile page",
    };
  } catch (error) {
    console.error(
      `[DIAGNOSTIC] Erreur lors de la vérification du profil web: ${error.message}`
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  getUserGames,
  getGameNews,
  getUserProfile,
  checkSteamProfileGamesCount,
};
