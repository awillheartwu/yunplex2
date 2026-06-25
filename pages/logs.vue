<script setup lang="ts">
import { ACTIVITY_LOGS_ROUTE } from '~~/lib/activity-navigation'

await navigateTo(ACTIVITY_LOGS_ROUTE, { replace: true, redirectCode: 302 })
</script>
