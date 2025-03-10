const express = require("express");
const router = express.Router();
const steamService = require("../services/steamService");
const gamesSyncService = require("../services/gamesSyncService");
const User = require("../models/User");

// Jeux populaires qui auront des timestamps manuels pour les tests
const TEST_GAMES_WITH_UPDATES = {
  730: { name: "Counter-Strike 2", timestamp: Date.now() - 3600000 }, // Mis à jour il y a 1 heure
  570: { name: "Dota 2", timestamp: Date.now() - 7200000 }, // Mis à jour il y a 2 heures
  440: { name: "Team Fortress 2", timestamp: Date.now() - 86400000 }, // Mis à jour il y a 24 heures
};

// Route pour récupérer la liste des jeux d'un utilisateur
router.get("/games/:steamId", async (req, res) => {
  const { steamId } = req.params;

  try {
    console.log(`Demande de jeux pour l'utilisateur ${steamId}`);

    // Vérifier que le steamId est valide
    if (!steamId || steamId.length < 5) {
      return res.status(400).json({
        status: "error",
        message: "SteamID invalide",
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findOne({ steamId });

    if (!user) {
      console.log(`Utilisateur ${steamId} non trouvé dans la base de données`);
    } else {
      console.log(
        `Utilisateur ${user.username} trouvé, possède ${user.ownedGames.length} jeux en base`
      );
    }

    // Vérifier si l'utilisateur a des jeux en attente
    if (user && user.pendingNewGames && user.pendingNewGames.length > 0) {
      // Synchroniser les jeux en attente
      const syncResult = await gamesSyncService.syncPendingGamesForUser(
        user._id
      );
      console.log(
        `${syncResult.processedGames.length} jeux en attente synchronisés pour ${user.steamId}`
      );
    }

    // Récupérer la liste des jeux depuis l'API Steam
    console.log(`Récupération des jeux depuis l'API Steam pour ${steamId}`);
    const games = await steamService.getUserGames(steamId);
    console.log(`API Steam a retourné ${games.length} jeux pour ${steamId}`);

    // Vérification de cohérence avec la base de données
    if (user && games.length < user.ownedGames.length * 0.9) {
      // Si moins de 90% des jeux connus
      console.warn(
        `ATTENTION: L'API Steam a retourné seulement ${games.length} jeux alors que ${user.ownedGames.length} sont connus dans la base`
      );

      // Récupérer les jeux depuis la base de données
      console.log(
        `Utilisation des données de la base pour enrichir la réponse...`
      );

      // Créer un Map des jeux de l'API pour une recherche rapide
      const apiGamesMap = new Map();
      games.forEach((game) => {
        apiGamesMap.set(game.appid.toString(), game);
      });

      // Chercher les jeux dans d'autres sources comme steamDB
      console.log(
        "Base de données contient plus de jeux que l'API, enrichissement possible requis."
      );
    }

    // Inclure les informations de dernières actualités pour les jeux suivis
    if (user && user.followedGames) {
      // Créer une map des jeux suivis pour un accès rapide
      const followedGamesMap = new Map();
      user.followedGames.forEach((followedGame) => {
        followedGamesMap.set(followedGame.appId, followedGame);
      });

      // Enrichir chaque jeu avec les informations de suivi
      const enrichedGames = games.map((game) => {
        const appId = game.appid.toString();
        const followedGame = followedGamesMap.get(appId);

        // Ajouter les informations de suivi si le jeu est suivi
        if (followedGame) {
          return {
            ...game,
            isFollowed: true,
            lastNewsTimestamp: followedGame.lastNewsTimestamp || 0,
            lastUpdateTimestamp: followedGame.lastUpdateTimestamp || 0,
          };
        }

        // Jeu non suivi
        return {
          ...game,
          isFollowed: false,
          lastNewsTimestamp: 0,
          lastUpdateTimestamp: 0,
        };
      });

      return res.json({
        status: "success",
        games: enrichedGames,
        totalGames: enrichedGames.length,
        storedGamesCount: user.ownedGames.length,
        apiResponse: enrichedGames.length,
      });
    }

    // Si l'utilisateur n'a pas de jeux suivis, retourner simplement la liste des jeux
    return res.json({
      status: "success",
      games,
      totalGames: games.length,
      storedGamesCount: user ? user.ownedGames.length : 0,
      apiResponse: games.length,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des jeux:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la récupération des jeux",
      error: error.message,
    });
  }
});

// Route pour récupérer les actualités d'un jeu
router.get("/news/:appId", async (req, res) => {
  const { appId } = req.params;
  const { count, maxLength, language, steamOnly } = req.query;

  try {
    // Vérifier que l'appId est valide
    if (!appId || isNaN(parseInt(appId))) {
      return res.status(400).json({
        status: "error",
        message: "AppID invalide",
      });
    }

    // Récupérer les actualités
    const news = await steamService.getGameNews(
      appId,
      count ? parseInt(count) : 5,
      maxLength ? parseInt(maxLength) : 300,
      language || "fr",
      steamOnly === "true"
    );

    return res.json({
      status: "success",
      news,
      count: news.length,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des actualités:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la récupération des actualités",
      error: error.message,
    });
  }
});

// Récupérer le profil d'un utilisateur Steam
router.get("/profile/:steamId", async (req, res) => {
  try {
    const { steamId } = req.params;

    // Valider le SteamID
    if (!steamId || steamId.length < 10) {
      return res.status(400).json({ message: "SteamID invalide" });
    }

    // Récupérer le profil
    const profile = await steamService.getUserProfile(steamId);

    if (!profile) {
      return res.status(404).json({ message: "Profil Steam non trouvé" });
    }

    res.json(profile);
  } catch (error) {
    console.error("Erreur lors de la récupération du profil:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Route pour récupérer la liste complète des jeux d'un utilisateur (API + Base de données)
router.get("/all-games/:steamId", async (req, res) => {
  const { steamId } = req.params;

  try {
    console.log(
      `Demande de liste complète de jeux pour l'utilisateur ${steamId}`
    );

    // Vérifier que le steamId est valide
    if (!steamId || steamId.length < 5) {
      return res.status(400).json({
        status: "error",
        message: "SteamID invalide",
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    console.log(
      `Utilisateur ${user.username} trouvé, possède ${user.ownedGames.length} jeux en base`
    );

    // Récupérer la liste des jeux depuis l'API Steam (tentative)
    console.log(`Récupération des jeux depuis l'API Steam pour ${steamId}`);
    let apiGames = [];
    try {
      apiGames = await steamService.getUserGames(steamId);
      console.log(
        `API Steam a retourné ${apiGames.length} jeux pour ${steamId}`
      );
    } catch (apiError) {
      console.error(
        `Erreur lors de la récupération des jeux via l'API:`,
        apiError
      );
      console.log(`Utilisation uniquement des jeux en base de données`);
    }

    // Créer un Map des jeux de l'API pour une recherche rapide
    const apiGamesMap = new Map();
    apiGames.forEach((game) => {
      apiGamesMap.set(game.appid.toString(), game);
    });

    // Créer un Map des jeux suivis pour un accès rapide
    const followedGamesMap = new Map();
    if (user.followedGames) {
      user.followedGames.forEach((followedGame) => {
        followedGamesMap.set(followedGame.appId, followedGame);
      });
    }

    // Préparer la liste complète des jeux
    const completeGames = [];

    // Ajouter d'abord tous les jeux de l'API (ils ont toutes les infos)
    apiGames.forEach((game) => {
      const appId = game.appid.toString();
      const followedGame = followedGamesMap.get(appId);

      completeGames.push({
        ...game,
        isFollowed: !!followedGame,
        lastNewsTimestamp: followedGame
          ? followedGame.lastNewsTimestamp || 0
          : 0,
        lastUpdateTimestamp: followedGame
          ? followedGame.lastUpdateTimestamp || 0
          : 0,
        source: "api",
      });
    });

    // Ajouter les jeux qui sont uniquement dans la base de données
    for (const dbGame of user.ownedGames) {
      const appId = dbGame.appId;

      // Vérifier si ce jeu existe déjà dans la liste (via l'API)
      if (!apiGamesMap.has(appId)) {
        // Ce jeu n'est pas dans la liste de l'API, l'ajouter depuis la DB
        const followedGame = followedGamesMap.get(appId);

        const gameData = {
          appid: parseInt(appId),
          name: followedGame ? followedGame.name : `Jeu #${appId}`,
          img_logo_url: followedGame ? followedGame.logoUrl : null,
          isFollowed: !!followedGame,
          lastNewsTimestamp: followedGame
            ? followedGame.lastNewsTimestamp || 0
            : 0,
          lastUpdateTimestamp: followedGame
            ? followedGame.lastUpdateTimestamp || 0
            : 0,
          source: "database",
          addedAt: dbGame.addedAt,
        };

        completeGames.push(gameData);
      }
    }

    console.log(
      `Liste complète générée avec ${completeGames.length} jeux (${
        apiGames.length
      } de l'API, ${
        completeGames.length - apiGames.length
      } de la base de données uniquement)`
    );

    return res.json({
      status: "success",
      games: completeGames,
      totalGames: completeGames.length,
      apiGamesCount: apiGames.length,
      databaseOnlyCount: completeGames.length - apiGames.length,
      storedGamesCount: user.ownedGames.length,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des jeux:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la récupération des jeux",
      error: error.message,
    });
  }
});

// Route de diagnostic pour vérifier la bibliothèque complète d'un utilisateur
router.get("/diagnostic/library/:steamId", async (req, res) => {
  const { steamId } = req.params;

  try {
    console.log(
      `[DIAGNOSTIC] Démarrage du diagnostic complet pour l'utilisateur ${steamId}`
    );

    // 1. Vérifier combien de jeux sont dans la base de données
    const user = await User.findOne({ steamId });
    const dbGamesCount = user ? user.ownedGames.length : 0;
    console.log(
      `[DIAGNOSTIC] Nombre de jeux dans la base de données: ${dbGamesCount}`
    );

    // 2. Récupérer les jeux via l'API Steam
    console.log(`[DIAGNOSTIC] Récupération des jeux via l'API Steam...`);
    const steamApiGames = await steamService.getUserGames(steamId);
    console.log(
      `[DIAGNOSTIC] Nombre de jeux récupérés via l'API Steam: ${steamApiGames.length}`
    );

    // 3. Vérifier les compteurs dans la réponse de l'API
    const apiResponseGameCount =
      steamApiGames.response?.game_count || "Non disponible";
    console.log(
      `[DIAGNOSTIC] Compteur de jeux dans la réponse de l'API: ${apiResponseGameCount}`
    );

    // 4. Essayer de vérifier via le profil web Steam (méthode alternative)
    const webProfileCheck = await steamService.checkSteamProfileGamesCount(
      steamId
    );
    const webProfileGamesCount = webProfileCheck.success
      ? webProfileCheck.estimatedCount
      : "Échec de l'estimation";
    console.log(
      `[DIAGNOSTIC] Estimation du nombre de jeux via le profil web: ${webProfileGamesCount}`
    );

    // 5. Vérifier si des jeux ont déjà été synchronisés
    const syncedGamesCount =
      user && user.lastSyncedGames ? user.lastSyncedGames.length : 0;
    console.log(
      `[DIAGNOSTIC] Nombre de jeux synchronisés précédemment: ${syncedGamesCount}`
    );

    // Réponse avec toutes les informations recueillies
    return res.json({
      status: "success",
      diagnosticResults: {
        userId: steamId,
        username: user ? user.username : "Utilisateur non trouvé",
        databaseGamesCount: dbGamesCount,
        apiGamesCount: steamApiGames.length,
        apiResponseGameCount,
        webProfileGamesCount,
        syncedGamesCount,
        lastChecked: user ? user.lastChecked : null,
        createdAt: user ? user.createdAt : null,
        discrepancyDetected:
          steamApiGames.length !== dbGamesCount ||
          (webProfileCheck.success &&
            webProfileCheck.estimatedCount > dbGamesCount),
      },
      recommendations: [],
    });
  } catch (error) {
    console.error(`[DIAGNOSTIC] Erreur lors du diagnostic: ${error.message}`);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors du diagnostic de la bibliothèque",
      error: error.message,
    });
  }
});

module.exports = router;
