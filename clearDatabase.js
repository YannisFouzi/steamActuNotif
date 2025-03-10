require("dotenv").config();
const mongoose = require("mongoose");

// Connexion à MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("Erreur: Variable d'environnement MONGODB_URI non définie");
  process.exit(1);
}

console.log("Connexion à MongoDB...");
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("Connecté à MongoDB");

    try {
      // Récupérer toutes les collections
      const collections = await mongoose.connection.db.collections();

      console.log(`${collections.length} collections trouvées.`);

      // Supprimer chaque collection
      for (const collection of collections) {
        console.log(
          `Suppression de la collection: ${collection.collectionName}`
        );
        await collection.drop();
      }

      console.log("Base de données vidée avec succès!");
    } catch (error) {
      console.error("Erreur lors de la suppression des collections:", error);
    } finally {
      // Fermer la connexion
      await mongoose.connection.close();
      console.log("Connexion à MongoDB fermée");
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("Erreur de connexion à MongoDB:", err);
    process.exit(1);
  });
