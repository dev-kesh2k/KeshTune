package br.com.centralappshub.keshtune.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// Cópia local da biblioteca: a tela abre na hora (e sem internet) e a rede só atualiza.

@Entity(tableName = "tracks")
data class TrackEntity(
    @PrimaryKey val id: String,
    val title: String,
    val artists: List<ArtistRef>,
    val albumId: String?,
    val albumTitle: String?,
    val coverUrl: String?,
    val durationMs: Long,
    val source: String,
    val playable: Boolean,
)

@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val ownerName: String?,
    val image: String?,
    val trackCount: Int,
    val sortOrder: Int,
)

@Entity(tableName = "playlist_tracks", primaryKeys = ["playlistId", "position"])
data class PlaylistTrackEntity(val playlistId: String, val position: Int, val trackId: String)

@Entity(tableName = "liked")
data class LikedEntity(@PrimaryKey val trackId: String, val sortOrder: Long)

/** Música baixada: o arquivo fica em files/downloads/<trackId>.audio (ver DownloadFiles). */
@Entity(tableName = "downloads")
data class DownloadEntity(@PrimaryKey val trackId: String, val bytes: Long, val downloadedAt: Long)

fun Track.toEntity() = TrackEntity(id, title, artists, album?.id, album?.title, coverUrl, durationMs, source, playable)

fun TrackEntity.toTrack(liked: Boolean = false) = Track(
    id = id, title = title, durationMs = durationMs, source = source, playable = playable, coverUrl = coverUrl,
    album = albumId?.let { AlbumRef(it, albumTitle.orEmpty()) }, artists = artists, liked = liked,
)

fun PlaylistCard.toEntity(order: Int) = PlaylistEntity(id, name, ownerName, image, trackCount, order)

class Converters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    fun artistsToString(v: List<ArtistRef>): String = json.encodeToString(v)

    @TypeConverter
    fun stringToArtists(v: String): List<ArtistRef> = runCatching { json.decodeFromString<List<ArtistRef>>(v) }.getOrDefault(emptyList())
}

@Dao
interface LibraryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTracks(tracks: List<TrackEntity>)

    @Query("SELECT * FROM tracks WHERE id = :id")
    suspend fun track(id: String): TrackEntity?

    @Query("SELECT * FROM playlists ORDER BY sortOrder")
    fun playlists(): Flow<List<PlaylistEntity>>

    @Query("SELECT * FROM playlists WHERE id = :id")
    fun playlist(id: String): Flow<PlaylistEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPlaylists(p: List<PlaylistEntity>)

    @Query("DELETE FROM playlists WHERE id NOT IN (:keep)")
    suspend fun deletePlaylistsExcept(keep: List<String>)

    @Transaction
    suspend fun replacePlaylists(p: List<PlaylistEntity>) {
        deletePlaylistsExcept(p.map { it.id })
        upsertPlaylists(p)
    }

    @Query("SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.trackId WHERE pt.playlistId = :id ORDER BY pt.position")
    fun playlistTracks(id: String): Flow<List<TrackEntity>>

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :id")
    suspend fun clearPlaylistTracks(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaylistTracks(items: List<PlaylistTrackEntity>)

    @Transaction
    suspend fun replacePlaylistTracks(id: String, tracks: List<Track>) {
        upsertTracks(tracks.map { it.toEntity() })
        clearPlaylistTracks(id)
        insertPlaylistTracks(tracks.mapIndexed { i, t -> PlaylistTrackEntity(id, i, t.id) })
    }

    @Query("SELECT t.* FROM liked l JOIN tracks t ON t.id = l.trackId ORDER BY l.sortOrder DESC")
    fun likedTracks(): Flow<List<TrackEntity>>

    @Query("SELECT EXISTS (SELECT 1 FROM liked WHERE trackId = :id)")
    fun isLiked(id: String): Flow<Boolean>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLiked(items: List<LikedEntity>)

    @Query("DELETE FROM liked WHERE trackId = :id")
    suspend fun deleteLiked(id: String)

    @Query("DELETE FROM liked")
    suspend fun clearLiked()

    @Transaction
    suspend fun replaceLiked(tracks: List<Track>) {
        upsertTracks(tracks.map { it.toEntity() })
        clearLiked()
        // A API manda das mais recentes para as mais antigas
        insertLiked(tracks.mapIndexed { i, t -> LikedEntity(t.id, (tracks.size - i).toLong()) })
    }

    @Query("SELECT t.* FROM downloads d JOIN tracks t ON t.id = d.trackId ORDER BY d.downloadedAt DESC")
    fun downloadedTracks(): Flow<List<TrackEntity>>

    @Query("SELECT trackId FROM downloads")
    fun downloadIds(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDownload(d: DownloadEntity)

    @Query("DELETE FROM downloads WHERE trackId = :id")
    suspend fun deleteDownload(id: String)

    @Query("DELETE FROM downloads")
    suspend fun clearDownloads()

    @Query("DELETE FROM playlist_tracks")
    suspend fun clearAllPlaylistTracks()

    @Query("DELETE FROM playlists")
    suspend fun clearPlaylists()

    @Transaction
    suspend fun clearAll() {
        clearDownloads()
        clearLiked()
        clearAllPlaylistTracks()
        clearPlaylists()
    }
}

@Database(
    entities = [TrackEntity::class, PlaylistEntity::class, PlaylistTrackEntity::class, LikedEntity::class, DownloadEntity::class],
    version = 2,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class KeshDatabase : RoomDatabase() {
    abstract fun library(): LibraryDao
}
