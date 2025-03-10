const express = require("express");
const router = express.Router();
const User = require("../models/User");
const steamService = require("../services/steamService");
const Game = require("../models/Game");

// Enregistrement d'un nouvel utilisateur ou mise à jour s'il existe déjà
router.post("/register", async (req, res) => {
  try {
    const { steamId } = req.body;

    if (!steamId) {
      return res.status(400).json({
        status: "error",
        message: "SteamID requis",
      });
    }

    console.log(
      `[DIAGNOSTIC] Début du processus d'enregistrement pour ${steamId}`
    );

    // Vérifier si l'utilisateur existe déjà
    let user = await User.findOne({ steamId });
    const isNewUser = !user;
    console.log(`[DIAGNOSTIC] Utilisateur existant: ${!isNewUser}`);

    // Récupérer les informations du profil Steam
    const profile = await steamService.getUserProfile(steamId);

    if (!profile) {
      console.log(`[DIAGNOSTIC] Profil Steam non trouvé pour ${steamId}`);
      return res.status(404).json({
        status: "error",
        message: "Profil Steam introuvable",
      });
    }

    console.log(`[DIAGNOSTIC] Profil Steam récupéré: ${profile.personaname}`);

    // Si l'utilisateur n'existe pas, créer un nouvel utilisateur
    if (isNewUser) {
      console.log(
        `[DIAGNOSTIC] Création d'un nouvel utilisateur pour ${profile.personaname} (${steamId})`
      );

      // Récupérer la liste des jeux - TENTATIVE AVEC PARAMÈTRES OPTIMISÉS
      console.log(`[DIAGNOSTIC] Récupération des jeux depuis l'API Steam...`);
      const games = await steamService.getUserGames(steamId);
      console.log(
        `[DIAGNOSTIC] ${games.length} jeux récupérés depuis l'API Steam`
      );

      // Vérifier si nous avons suffisamment de jeux pour ce steamID
      if (steamId === "76561198158439485" && games.length < 500) {
        console.warn(
          `[DIAGNOSTIC] ⚠️ ATTENTION: Nombre de jeux anormalement bas (${games.length}) pour ${steamId}`
        );
        console.warn(
          `[DIAGNOSTIC] ⚠️ L'API Steam semble ne pas renvoyer tous les jeux!`
        );
      }

      // Préparer la liste des IDs de jeux possédés
      const ownedGames = games.map((game) => ({
        appId: game.appid.toString(),
        addedAt: new Date(),
      }));

      console.log(
        `[DIAGNOSTIC] Conversion terminée: ${ownedGames.length} jeux à enregistrer en base`
      );

      // Structure et création de l'utilisateur
      user = new User({
        steamId,
        username: profile.personaname,
        avatarUrl: profile.avatarfull,
        followedGames: [],
        ownedGames, // Stocker tous les IDs des jeux possédés
        lastChecked: new Date(),
      });

      console.log(
        `[DIAGNOSTIC] Structure utilisateur créée, tentative de sauvegarde en base...`
      );

      // Test pour voir si des jeux sont perdus pendant la sauvegarde
      const beforeSaveCount = user.ownedGames.length;
      await user.save();
      const afterSaveCount = user.ownedGames.length;

      if (beforeSaveCount !== afterSaveCount) {
        console.error(
          `[DIAGNOSTIC] ⚠️ ERREUR: ${
            beforeSaveCount - afterSaveCount
          } jeux ont été perdus pendant la sauvegarde!`
        );
      }

      console.log(
        `[DIAGNOSTIC] Utilisateur sauvegardé en base avec ${user.ownedGames.length} jeux`
      );

      return res.status(201).json({
        status: "success",
        message: "Utilisateur créé avec succès",
        user: {
          _id: user._id,
          steamId: user.steamId,
          username: user.username,
          avatarUrl: user.avatarUrl,
          followedGames: [],
          notificationSettings: user.notificationSettings,
          ownedGamesCount: user.ownedGames.length,
          createdAt: user.createdAt,
        },
      });
    }

    // Si l'utilisateur existe déjà, mettre à jour son profil
    user.username = profile.personaname;
    user.avatarUrl = profile.avatarfull;
    user.lastChecked = new Date();

    // Option: forcer une synchronisation complète des jeux possédés
    if (req.body.forceSync) {
      console.log(
        `Forçage de la synchronisation des jeux pour ${profile.personaname}`
      );
      const games = await steamService.getUserGames(steamId);

      // Créer un Set des appIds actuels
      const existingAppIds = new Set(user.ownedGames.map((game) => game.appId));

      // Ajouter uniquement les nouveaux jeux
      for (const game of games) {
        const appId = game.appid.toString();
        if (!existingAppIds.has(appId)) {
          user.ownedGames.push({
            appId,
            addedAt: new Date(),
          });
        }
      }

      console.log(`${user.ownedGames.length} jeux après synchronisation`);
    }

    await user.save();

    return res.json({
      status: "success",
      message: "Utilisateur connecté avec succès",
      user: {
        _id: user._id,
        steamId: user.steamId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        followedGames: user.followedGames,
        notificationSettings: user.notificationSettings,
        ownedGamesCount: user.ownedGames.length,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Erreur lors de l'enregistrement de l'utilisateur:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de l'enregistrement de l'utilisateur",
      error: error.message,
    });
  }
});

// Récupérer les informations d'un utilisateur
router.get("/:steamId", async (req, res) => {
  try {
    const { steamId } = req.params;
    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    return res.json({
      status: "success",
      user: {
        _id: user._id,
        steamId: user.steamId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        followedGames: user.followedGames,
        notificationSettings: user.notificationSettings,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Erreur lors de la récupération de l'utilisateur:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la récupération de l'utilisateur",
      error: error.message,
    });
  }
});

// Suivre un jeu
router.post("/:steamId/follow", async (req, res) => {
  try {
    const { steamId } = req.params;
    const { appId, name, logoUrl } = req.body;

    if (!appId || !name) {
      return res.status(400).json({
        status: "error",
        message: "AppID et nom du jeu requis",
      });
    }

    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    // Vérifier si le jeu est déjà suivi
    const gameIndex = user.followedGames.findIndex(
      (game) => game.appId === appId
    );

    if (gameIndex !== -1) {
      return res.status(400).json({
        status: "error",
        message: "Jeu déjà suivi",
      });
    }

    // Ajouter le jeu à la liste des jeux suivis de l'utilisateur
    user.followedGames.push({
      appId,
      name,
      logoUrl,
      lastNewsTimestamp: Date.now(),
      lastUpdateTimestamp: Date.now(),
    });

    await user.save();

    // Ajouter également le jeu à la collection Game et l'utilisateur comme follower
    let gameDoc = await Game.findOne({ appId });

    if (!gameDoc) {
      // Si le jeu n'existe pas, le créer
      gameDoc = new Game({
        appId,
        name,
        logoUrl,
        lastNewsTimestamp: Date.now(),
        lastUpdateTimestamp: Date.now(),
        followers: [user._id],
      });
      await gameDoc.save();
      console.log(
        `Nouveau jeu ajouté à la collection centrale: ${name} (${appId})`
      );
    } else {
      // Si le jeu existe déjà, ajouter l'utilisateur comme follower s'il ne l'est pas déjà
      if (!gameDoc.followers.includes(user._id)) {
        gameDoc.followers.push(user._id);
        await gameDoc.save();
        console.log(
          `Utilisateur ${user.username} ajouté comme follower du jeu ${name}`
        );
      }
    }

    return res.json({
      status: "success",
      message: "Jeu ajouté aux favoris",
      followedGames: user.followedGames,
    });
  } catch (error) {
    console.error("Erreur lors de l'ajout du jeu aux favoris:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de l'ajout du jeu aux favoris",
      error: error.message,
    });
  }
});

// Ne plus suivre un jeu
router.delete("/:steamId/follow/:appId", async (req, res) => {
  try {
    const { steamId, appId } = req.params;

    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    // Vérifier si le jeu est suivi
    const gameIndex = user.followedGames.findIndex(
      (game) => game.appId === appId
    );

    if (gameIndex === -1) {
      return res.status(400).json({
        status: "error",
        message: "Jeu non suivi",
      });
    }

    // Retirer le jeu de la liste des jeux suivis
    user.followedGames.splice(gameIndex, 1);
    await user.save();

    // Retirer également l'utilisateur de la liste des followers dans la collection Game
    const gameDoc = await Game.findOne({ appId });

    if (gameDoc) {
      // Retirer l'utilisateur des followers
      const followerIndex = gameDoc.followers.indexOf(user._id);
      if (followerIndex !== -1) {
        gameDoc.followers.splice(followerIndex, 1);
        await gameDoc.save();
        console.log(
          `Utilisateur ${user.username} retiré des followers du jeu ${appId}`
        );
      }

      // Si le jeu n'a plus de followers, on pourrait envisager de le supprimer
      // mais on le garde pour l'instant pour l'historique
      if (gameDoc.followers.length === 0) {
        console.log(`Le jeu ${appId} n'a plus de followers`);
      }
    }

    return res.json({
      status: "success",
      message: "Jeu retiré des favoris",
      followedGames: user.followedGames,
    });
  } catch (error) {
    console.error("Erreur lors du retrait du jeu des favoris:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors du retrait du jeu des favoris",
      error: error.message,
    });
  }
});

// Mettre à jour les paramètres de notification
router.put("/:steamId/notifications", async (req, res) => {
  try {
    const { steamId } = req.params;
    const { enabled, pushToken, autoFollowNewGames } = req.body;

    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    // Mettre à jour les paramètres de notification
    if (typeof enabled === "boolean") {
      user.notificationSettings.enabled = enabled;
    }

    if (pushToken) {
      user.notificationSettings.pushToken = pushToken;
    }

    if (typeof autoFollowNewGames === "boolean") {
      user.notificationSettings.autoFollowNewGames = autoFollowNewGames;
    }

    await user.save();

    return res.json({
      status: "success",
      message: "Paramètres de notification mis à jour",
      notificationSettings: user.notificationSettings,
    });
  } catch (error) {
    console.error(
      "Erreur lors de la mise à jour des paramètres de notification:",
      error
    );
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la mise à jour des paramètres de notification",
      error: error.message,
    });
  }
});

// Forcer la synchronisation des jeux d'un utilisateur
router.post("/:steamId/sync-games", async (req, res) => {
  try {
    const { steamId } = req.params;

    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ steamId });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    console.log(
      `Démarrage de la synchronisation complète des jeux pour ${user.username}`
    );

    // Récupérer la liste complète des jeux depuis Steam
    const games = await steamService.getUserGames(steamId);
    console.log(
      `${games.length} jeux récupérés depuis Steam pour ${user.username}`
    );

    // Créer un Set des appIds actuels pour une recherche efficace
    const existingAppIds = new Set(user.ownedGames.map((game) => game.appId));
    let newGamesCount = 0;

    // Ajouter uniquement les nouveaux jeux
    for (const game of games) {
      const appId = game.appid.toString();
      if (!existingAppIds.has(appId)) {
        user.ownedGames.push({
          appId,
          addedAt: new Date(),
        });
        newGamesCount++;
      }
    }

    // Sauvegarder les changements
    await user.save();
    console.log(
      `Synchronisation terminée. ${newGamesCount} nouveaux jeux ajoutés, total: ${user.ownedGames.length} jeux`
    );

    return res.json({
      status: "success",
      message: `Synchronisation terminée. ${newGamesCount} nouveaux jeux ajoutés.`,
      gamesCount: user.ownedGames.length,
      newGamesCount: newGamesCount,
    });
  } catch (error) {
    console.error("Erreur lors de la synchronisation des jeux:", error);
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de la synchronisation des jeux",
      error: error.message,
    });
  }
});

// Route pour forcer l'importation complète des jeux avec une méthode alternative
router.post("/:steamId/force-library-import", async (req, res) => {
  try {
    const { steamId } = req.params;
    const { method = "api" } = req.body; // 'api' or 'web'

    console.log(
      `[DIAGNOSTIC] Tentative d'importation complète de la bibliothèque pour ${steamId} via méthode "${method}"`
    );

    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ steamId });

    if (!user) {
      console.log(
        `[DIAGNOSTIC] Utilisateur ${steamId} non trouvé en base de données`
      );
      return res.status(404).json({
        status: "error",
        message: "Utilisateur non trouvé",
      });
    }

    console.log(
      `[DIAGNOSTIC] Utilisateur ${user.username} trouvé, début de l'importation...`
    );

    // Statistiques avant importation
    const existingGamesCount = user.ownedGames.length;
    console.log(
      `[DIAGNOSTIC] Nombre de jeux avant importation: ${existingGamesCount}`
    );

    // Créer un Set des jeux existants pour vérification rapide
    const existingGameIds = new Set(user.ownedGames.map((game) => game.appId));

    // Récupérer les jeux via l'API Steam (méthode standard)
    const steamGames = await steamService.getUserGames(steamId);
    console.log(
      `[DIAGNOSTIC] ${steamGames.length} jeux récupérés via l'API Steam`
    );

    // Ajouter les nouveaux jeux à l'utilisateur
    let newGamesCount = 0;

    for (const game of steamGames) {
      const appId = game.appid.toString();

      if (!existingGameIds.has(appId)) {
        user.ownedGames.push({
          appId: appId,
          addedAt: new Date(),
        });

        existingGameIds.add(appId); // Mettre à jour l'ensemble pour les prochaines vérifications
        newGamesCount++;
      }
    }

    console.log(
      `[DIAGNOSTIC] ${newGamesCount} nouveaux jeux trouvés via l'API Steam`
    );

    // Si la méthode est 'web', tenter aussi de récupérer les jeux via le profil web
    // Note: Cette partie est expérimentale et pourrait ne pas fonctionner comme prévu
    if (method === "web") {
      console.log(
        `[DIAGNOSTIC] Tentative de récupération via le profil web (expérimental)...`
      );

      try {
        const webProfileCheck = await steamService.checkSteamProfileGamesCount(
          steamId
        );

        if (
          webProfileCheck.success &&
          webProfileCheck.source === "javascript_data" &&
          webProfileCheck.gamesData
        ) {
          console.log(
            `[DIAGNOSTIC] ${webProfileCheck.gamesData.length} jeux trouvés via le profil web`
          );

          // Ajouter les jeux du profil web qui ne sont pas déjà dans la liste
          let webNewGamesCount = 0;

          for (const game of webProfileCheck.gamesData) {
            const appId = game.appid.toString();

            if (!existingGameIds.has(appId)) {
              user.ownedGames.push({
                appId: appId,
                addedAt: new Date(),
              });

              existingGameIds.add(appId);
              webNewGamesCount++;
            }
          }

          console.log(
            `[DIAGNOSTIC] ${webNewGamesCount} nouveaux jeux supplémentaires trouvés via le profil web`
          );
          newGamesCount += webNewGamesCount;
        } else {
          console.log(
            `[DIAGNOSTIC] Impossible de récupérer la liste des jeux via le profil web`
          );
        }
      } catch (webError) {
        console.error(
          `[DIAGNOSTIC] Erreur lors de la récupération via le profil web: ${webError.message}`
        );
      }
    }

    // Sauvegarder les modifications
    await user.save();
    const finalGamesCount = user.ownedGames.length;

    console.log(
      `[DIAGNOSTIC] Importation terminée. ${existingGamesCount} → ${finalGamesCount} jeux (+${newGamesCount})`
    );

    return res.json({
      status: "success",
      message: `Importation terminée avec succès. ${newGamesCount} nouveaux jeux ajoutés.`,
      stats: {
        beforeImport: existingGamesCount,
        afterImport: finalGamesCount,
        newGamesAdded: newGamesCount,
      },
    });
  } catch (error) {
    console.error(
      `[DIAGNOSTIC] Erreur lors de l'importation de la bibliothèque: ${error.message}`
    );
    return res.status(500).json({
      status: "error",
      message: "Erreur lors de l'importation de la bibliothèque",
      error: error.message,
    });
  }
});

module.exports = router;
